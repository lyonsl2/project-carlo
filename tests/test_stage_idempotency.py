from pathlib import Path

from pdf_extract.storage import SCHEMA_PATH, connect_db, save_json_list
from pdf_extract.sync import BulletinLink, fetch_bulletins, process_bulletins


def _setup_test_db(tmp_path: Path) -> Path:
    """Create a test DB with schema and a test parish."""
    db_path = tmp_path / "parish_events.db"
    conn = connect_db(db_path)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.execute(
        "INSERT INTO parish(slug, name, source_type, source_provider_id, created_at) VALUES (?, ?, ?, ?, ?)",
        ("test-parish", "Test Parish", "ecatholic", "https://test.org", "2026-01-01T00:00:00Z"),
    )
    conn.commit()
    conn.close()
    return db_path


def _patch_paths(monkeypatch, tmp_path: Path) -> None:
    """Point all data file paths to tmp_path."""
    monkeypatch.setattr("pdf_extract.sync.BULLETINS_METADATA_PATH", tmp_path / "metadata.json")
    monkeypatch.setattr("pdf_extract.sync.CHURCHES_PATH", tmp_path / "churches.json")
    monkeypatch.setattr("pdf_extract.sync.EVENTS_PATH", tmp_path / "events.json")


def test_fetch_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.sync.connect_db", lambda: connect_db(db_path))

    monkeypatch.setattr(
        "pdf_extract.sync._build_bulletin_link",
        lambda source_type, source_provider_id, *, page=None: BulletinLink(
            source_url="https://example.org/bulletin.pdf",
            fetch_url="https://example.org/bulletin.pdf",
        ),
    )
    monkeypatch.setattr("pdf_extract.sync._download_pdf", lambda **kwargs: b"%PDF-1.4 fake")
    monkeypatch.setattr(
        "pdf_extract.sync._launch_browser",
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
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.sync.connect_db", lambda: connect_db(db_path))

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
        "pdf_extract.sync.extract_events",
        lambda pdf_bytes, model="gemini-3-flash-preview": {
            "churches": [{"id": "c1", "name": "St. Mary", "address": "123 Main"}],
            "events": [
                {
                    "church_id": "c1",
                    "type": "mass",
                    "kind": "weekly",
                    "day_of_week": "Sunday",
                    "date": None,
                    "start_time": "9:00 AM",
                    "end_time": None,
                    "cancelled": False,
                }
            ],
        },
    )

    first = process_bulletins(parish_name="Test Parish")
    second = process_bulletins(parish_name="Test Parish")

    assert first["processed_bulletins"] == 1
    assert first["inserted_events"] == 1
    assert second["processed_bulletins"] == 0
    assert second["inserted_events"] == 0
