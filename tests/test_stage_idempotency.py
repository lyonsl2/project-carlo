from pathlib import Path

from pdf_extract.fetch import BulletinLink, fetch_bulletins
from pdf_extract.process import process_bulletins
from pdf_extract.storage import SCHEMA_PATH, connect_db, save_json_list


def _setup_test_db(tmp_path: Path) -> Path:
    """Create a test DB with schema, a test parish, and seed churches."""
    db_path = tmp_path / "parish_events.db"
    conn = connect_db(db_path)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.execute(
        """INSERT INTO parish(
            slug, name, homepage_url, bulletin_provider, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)""",
        (
            "test-parish",
            "Test Parish",
            "https://test.org",
            "ecatholic",
            None,
            "2026-01-01T00:00:00Z",
        ),
    )
    parish_id = conn.execute("SELECT id FROM parish WHERE slug = 'test-parish'").fetchone()["id"]
    conn.execute(
        "INSERT INTO church(parish_id, slug, name, address_line1, city, state, postal_code, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (parish_id, "st-mary-anytown", "St. Mary", "123 Main St", "Anytown", "NY", "14000",
         "2026-01-01T00:00:00Z"),
    )
    conn.commit()
    conn.close()
    return db_path


def _patch_fetch_paths(monkeypatch, tmp_path: Path) -> None:
    """Point fetch data file paths to tmp_path."""
    monkeypatch.setattr("pdf_extract.fetch.BULLETINS_METADATA_PATH", tmp_path / "metadata.json")


def _patch_process_paths(monkeypatch, tmp_path: Path) -> None:
    """Point process data file paths to tmp_path."""
    monkeypatch.setattr("pdf_extract.process.BULLETINS_METADATA_PATH", tmp_path / "metadata.json")
    monkeypatch.setattr("pdf_extract.process.EVENTS_PATH", tmp_path / "events.json")
    # These tests stub PDFs with non-PDF bytes; skip the pypdf-based truncation helper.
    monkeypatch.setattr("pdf_extract.process.ensure_truncated_pdf", lambda path, **kwargs: path)


def test_fetch_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_fetch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.fetch.connect_db", lambda: connect_db(db_path))

    monkeypatch.setattr(
        "pdf_extract.fetch._build_bulletin_link",
        lambda bulletin_provider, fetch_provider_id, *, page=None: BulletinLink(
            source_url="https://example.org/bulletin.pdf",
            fetch_url="https://example.org/bulletin.pdf",
        ),
    )
    monkeypatch.setattr("pdf_extract.fetch._download_pdf", lambda **kwargs: b"%PDF-1.4 fake")
    monkeypatch.setattr(
        "pdf_extract.fetch._launch_browser",
        lambda: (type("PW", (), {"stop": lambda self: None})(), type("B", (), {"close": lambda self: None})(), None),
    )

    pdf_dir = tmp_path / "bulletins"
    first = fetch_bulletins(parish_name="Test Parish", pdf_dir=pdf_dir)
    second = fetch_bulletins(parish_name="Test Parish", pdf_dir=pdf_dir)

    assert first["fetched_bulletins"] == 1
    assert second["fetched_bulletins"] == 0
    assert second["skipped_existing_urls"] == 1


def test_process_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    # Create a test PDF
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"fake")

    # Write a metadata entry for an unprocessed bulletin
    save_json_list(tmp_path / "metadata.json", [
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/parsed.pdf",
            "pdf_path": str(pdf_path),
            "content_hash": "def",
            "fetched_at": "2026-01-01T00:00:00Z",
            "processed_at": None,
            "published_date": "2026-02-22",
        }
    ])

    monkeypatch.setattr(
        "pdf_extract.process.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview": {
            "events": [
                {
                    "church_slug": "st-mary-anytown",
                    "type": "mass",
                    "kind": "weekly",
                    "day_of_week": "Sunday",
                    "date": None,
                    "start_time": "9:00 AM",
                    "end_time": None,
                    "cancelled": False,
                    "page_number": 1,
                }
            ],
            "church_list_needs_review": False,
        },
    )

    first = process_bulletins(parish_name="Test Parish")
    second = process_bulletins(parish_name="Test Parish")

    assert first["processed_bulletins"] == 1
    assert first["inserted_events"] == 1
    assert second["processed_bulletins"] == 0
    assert second["inserted_events"] == 0


def test_process_only_latest_fetched_unprocessed_per_parish(monkeypatch, tmp_path: Path) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    older_pdf = tmp_path / "older.pdf"
    latest_pdf = tmp_path / "latest.pdf"
    older_pdf.write_bytes(b"older")
    latest_pdf.write_bytes(b"latest")

    save_json_list(tmp_path / "metadata.json", [
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/older.pdf",
            "pdf_path": str(older_pdf),
            "content_hash": "older",
            "fetched_at": "2026-01-01T00:00:00Z",
            "processed_at": None,
            "published_date": "2026-03-01",
        },
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/latest.pdf",
            "pdf_path": str(latest_pdf),
            "content_hash": "latest",
            "fetched_at": "2026-02-01T00:00:00Z",
            "processed_at": None,
            "published_date": "2026-01-01",
        },
    ])

    processed_urls: list[str] = []

    def _extract_events(pdf_bytes, *, churches, model="gemini-3-flash-preview"):
        if pdf_bytes == b"older":
            processed_urls.append("https://example.org/older.pdf")
        elif pdf_bytes == b"latest":
            processed_urls.append("https://example.org/latest.pdf")
        return {
            "events": [
                {
                    "church_slug": "st-mary-anytown",
                    "type": "mass",
                    "kind": "weekly",
                    "day_of_week": "Sunday",
                    "date": None,
                    "start_time": "9:00 AM",
                    "end_time": None,
                    "cancelled": False,
                    "page_number": 1,
                }
            ],
            "church_list_needs_review": False,
        }

    monkeypatch.setattr("pdf_extract.process.extract_events", _extract_events)

    result = process_bulletins(parish_name="Test Parish")

    assert result["processed_bulletins"] == 1
    assert result["inserted_events"] == 1
    assert processed_urls == ["https://example.org/latest.pdf"]


def test_process_skips_older_when_latest_already_processed(monkeypatch, tmp_path: Path) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    older_pdf = tmp_path / "older.pdf"
    latest_pdf = tmp_path / "latest.pdf"
    older_pdf.write_bytes(b"older")
    latest_pdf.write_bytes(b"latest")

    save_json_list(tmp_path / "metadata.json", [
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/older.pdf",
            "pdf_path": str(older_pdf),
            "content_hash": "older",
            "fetched_at": "2026-01-01T00:00:00Z",
            "processed_at": None,
            "published_date": None,
        },
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/latest.pdf",
            "pdf_path": str(latest_pdf),
            "content_hash": "latest",
            "fetched_at": "2026-02-01T00:00:00Z",
            "processed_at": "2026-02-02T00:00:00Z",
            "published_date": None,
        },
    ])

    monkeypatch.setattr(
        "pdf_extract.process.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview": {
            "events": [
                {
                    "church_slug": "st-mary-anytown",
                    "type": "mass",
                    "kind": "weekly",
                    "day_of_week": "Sunday",
                    "date": None,
                    "start_time": "9:00 AM",
                    "end_time": None,
                    "cancelled": False,
                    "page_number": 1,
                }
            ],
            "church_list_needs_review": False,
        },
    )

    result = process_bulletins(parish_name="Test Parish")

    assert result["processed_bulletins"] == 0
    assert result["inserted_events"] == 0
