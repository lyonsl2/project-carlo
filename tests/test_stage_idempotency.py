import json
import logging
import threading
from contextlib import contextmanager
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
    """Point process data file paths (and the shared result cache) to tmp_path."""
    monkeypatch.setattr("pdf_extract.process.BULLETINS_METADATA_PATH", tmp_path / "metadata.json")
    monkeypatch.setattr("pdf_extract.process.EVENTS_PATH", tmp_path / "events.json")
    monkeypatch.setattr("pdf_extract.runner.RUNS_DIR", tmp_path / "runs")
    # These tests stub PDFs with non-PDF bytes; skip the pypdf-based truncation helper.
    # Patched on storage where load_bulletin_work_item now lives.
    monkeypatch.setattr("pdf_extract.storage.ensure_truncated_pdf", lambda path, **kwargs: path)


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

    @contextmanager
    def fake_launch_stealth_browser():
        yield None

    monkeypatch.setattr("pdf_extract.fetch.launch_stealth_browser", fake_launch_stealth_browser)

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
        "pdf_extract.classifiers.gemini.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None: {
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
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": None,
            "wrong_bulletin": False,
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

    def _extract_events(pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None):
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
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": None,
            "wrong_bulletin": False,
        }

    monkeypatch.setattr("pdf_extract.classifiers.gemini.extract_events", _extract_events)

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
        "pdf_extract.classifiers.gemini.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None: {
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
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": None,
            "wrong_bulletin": False,
        },
    )

    result = process_bulletins(parish_name="Test Parish")

    assert result["processed_bulletins"] == 0
    assert result["inserted_events"] == 0


def test_process_bounds_prepared_pdfs_to_concurrency(monkeypatch, tmp_path: Path) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    conn = connect_db(db_path)
    try:
        for idx in range(1, 3):
            parish_slug = f"test-parish-{idx}"
            conn.execute(
                """INSERT INTO parish(
                    slug, name, homepage_url, bulletin_provider, provider_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    parish_slug,
                    f"Test Parish {idx}",
                    f"https://test-{idx}.org",
                    "ecatholic",
                    None,
                    "2026-01-01T00:00:00Z",
                ),
            )
            parish_id = conn.execute(
                "SELECT id FROM parish WHERE slug = ?", (parish_slug,),
            ).fetchone()["id"]
            conn.execute(
                "INSERT INTO church(parish_id, slug, name, address_line1, city, state, postal_code, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    parish_id,
                    f"st-mary-anytown-{idx}",
                    "St. Mary",
                    "123 Main St",
                    "Anytown",
                    "NY",
                    "14000",
                    "2026-01-01T00:00:00Z",
                ),
            )
        conn.commit()
    finally:
        conn.close()

    parish_slugs = ["test-parish", "test-parish-1", "test-parish-2"]
    entries = []
    for idx, parish_slug in enumerate(parish_slugs):
        pdf_path = tmp_path / f"bulletin-{idx}.pdf"
        pdf_path.write_bytes(f"pdf-{idx}".encode())
        entries.append(
            {
                "parish_slug": parish_slug,
                "source_url": f"https://example.org/bulletin-{idx}.pdf",
                "pdf_path": str(pdf_path),
                "content_hash": f"hash-{idx}",
                "fetched_at": f"2026-01-0{idx + 1}T00:00:00Z",
                "processed_at": None,
                "published_date": None,
            }
        )
    save_json_list(tmp_path / "metadata.json", entries)

    started = threading.Event()
    extract_calls = 0
    prepare_calls = 0

    original_prepare = __import__(
        "pdf_extract.runner", fromlist=["load_bulletin_work_item"],
    ).load_bulletin_work_item

    def _load_bulletin_work_item(entry, conn):
        nonlocal prepare_calls
        prepare_calls += 1
        if prepare_calls == 2:
            assert started.wait(timeout=1), "second PDF prepared before extraction started"
        return original_prepare(entry, conn)

    def _extract_events(pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None):
        nonlocal extract_calls
        extract_calls += 1
        started.set()
        return {
            "events": [],
            "church_list_needs_review": False,
            "published_date": None,
            "wrong_bulletin": False,
        }

    monkeypatch.setattr("pdf_extract.runner.load_bulletin_work_item", _load_bulletin_work_item)
    monkeypatch.setattr("pdf_extract.classifiers.gemini.extract_events", _extract_events)

    result = process_bulletins(concurrency=1)

    assert result["processed_bulletins"] == 3
    assert result["inserted_events"] == 0
    assert extract_calls == 3


def test_process_skips_events_when_wrong_bulletin_flag_is_set(
    monkeypatch, tmp_path: Path, caplog,
) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    pdf_path = tmp_path / "wrong.pdf"
    pdf_path.write_bytes(b"fake")

    save_json_list(tmp_path / "metadata.json", [
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/wrong.pdf",
            "pdf_path": str(pdf_path),
            "content_hash": "abc",
            "fetched_at": "2026-01-01T00:00:00Z",
            "processed_at": None,
            "published_date": None,
        }
    ])

    monkeypatch.setattr(
        "pdf_extract.classifiers.gemini.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None: {
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
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": "2025-01-15",
            "wrong_bulletin": True,
        },
    )

    caplog.set_level(logging.WARNING, logger="pdf_extract.process")
    result = process_bulletins(parish_name="Test Parish")

    assert result["processed_bulletins"] == 1
    assert result["inserted_events"] == 0
    assert any(
        "flagged as wrong PDF" in rec.message for rec in caplog.records
    )

    metadata = json.loads((tmp_path / "metadata.json").read_text(encoding="utf-8"))
    entry = metadata[0]
    assert entry["processed_at"] is not None
    assert entry["published_date"] == "2025-01-15"

    events = json.loads((tmp_path / "events.json").read_text(encoding="utf-8"))
    assert events == []


def test_process_writes_published_date_and_note_into_metadata(
    monkeypatch, tmp_path: Path,
) -> None:
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    pdf_path = tmp_path / "good.pdf"
    pdf_path.write_bytes(b"fake")

    save_json_list(tmp_path / "metadata.json", [
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/good.pdf",
            "pdf_path": str(pdf_path),
            "content_hash": "xyz",
            "fetched_at": "2026-04-15T00:00:00Z",
            "processed_at": None,
            "published_date": None,
        }
    ])

    monkeypatch.setattr(
        "pdf_extract.classifiers.gemini.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None: {
            "events": [
                {
                    "church_slug": "st-mary-anytown",
                    "type": "mass",
                    "kind": "weekly",
                    "day_of_week": "Sunday",
                    "date": None,
                    "start_time": "11:00 AM",
                    "end_time": None,
                    "cancelled": False,
                    "page_number": 2,
                    "note": "Spanish",
                }
            ],
            "church_list_needs_review": False,
            "published_date": "2026-04-12",
            "wrong_bulletin": False,
        },
    )

    result = process_bulletins(parish_name="Test Parish")

    assert result["processed_bulletins"] == 1
    assert result["inserted_events"] == 1

    metadata = json.loads((tmp_path / "metadata.json").read_text(encoding="utf-8"))
    assert metadata[0]["published_date"] == "2026-04-12"

    events = json.loads((tmp_path / "events.json").read_text(encoding="utf-8"))
    assert len(events) == 1
    assert events[0]["note"] == "Spanish"


def test_process_compacts_events_from_superseded_bulletins(
    monkeypatch, tmp_path: Path,
) -> None:
    """events.json keeps only each parish's latest processed bulletin's rows."""
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
            "processed_at": "2026-01-02T00:00:00Z",
            "published_date": "2026-01-01",
        },
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/latest.pdf",
            "pdf_path": str(latest_pdf),
            "content_hash": "latest",
            "fetched_at": "2026-02-01T00:00:00Z",
            "processed_at": None,
            "published_date": None,
        },
    ])
    # Rows from the already-processed older bulletin, as today's events.json would hold.
    save_json_list(tmp_path / "events.json", [
        {
            "church_slug": "st-mary-anytown",
            "bulletin_source_url": "https://example.org/older.pdf",
            "event_type": "mass",
            "event_kind": "weekly",
            "day_of_week": "Saturday",
            "date": None,
            "start_time": "4:00 PM",
            "end_time": None,
            "cancelled": False,
            "page_number": 1,
            "note": None,
        }
    ])

    monkeypatch.setattr(
        "pdf_extract.classifiers.gemini.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None: {
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
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": "2026-02-01",
            "wrong_bulletin": False,
        },
    )

    result = process_bulletins(parish_name="Test Parish")

    assert result["processed_bulletins"] == 1
    assert result["inserted_events"] == 1

    events = json.loads((tmp_path / "events.json").read_text(encoding="utf-8"))
    assert [e["bulletin_source_url"] for e in events] == ["https://example.org/latest.pdf"]
    assert events[0]["day_of_week"] == "Sunday"


def test_process_compaction_keeps_published_latest_over_fetched_latest(
    monkeypatch, tmp_path: Path,
) -> None:
    """A re-served old issue (fetched later, published earlier) must not displace
    the events of the most recently *published* bulletin — that is the bulletin
    the frontend snapshot displays."""
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    current_pdf = tmp_path / "current.pdf"
    stale_pdf = tmp_path / "stale.pdf"
    current_pdf.write_bytes(b"current")
    stale_pdf.write_bytes(b"stale")

    save_json_list(tmp_path / "metadata.json", [
        {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/current.pdf",
            "pdf_path": str(current_pdf),
            "content_hash": "current",
            "fetched_at": "2026-05-23T00:00:00Z",
            "processed_at": "2026-05-23T01:00:00Z",
            "published_date": "2026-05-24",
        },
        {
            # Fetched later, but the parish site re-served a year-old issue.
            "parish_slug": "test-parish",
            "source_url": "https://example.org/stale.pdf",
            "pdf_path": str(stale_pdf),
            "content_hash": "stale",
            "fetched_at": "2026-06-07T00:00:00Z",
            "processed_at": None,
            "published_date": None,
        },
    ])
    save_json_list(tmp_path / "events.json", [
        {
            "church_slug": "st-mary-anytown",
            "bulletin_source_url": "https://example.org/current.pdf",
            "event_type": "mass",
            "event_kind": "weekly",
            "day_of_week": "Sunday",
            "date": None,
            "start_time": "9:00 AM",
            "end_time": None,
            "cancelled": False,
            "page_number": 1,
            "note": None,
        }
    ])

    monkeypatch.setattr(
        "pdf_extract.classifiers.gemini.extract_events",
        lambda pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None: {
            "events": [
                {
                    "church_slug": "st-mary-anytown",
                    "type": "mass",
                    "kind": "weekly",
                    "day_of_week": "Saturday",
                    "date": None,
                    "start_time": "4:00 PM",
                    "end_time": None,
                    "cancelled": False,
                    "page_number": 1,
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": "2025-06-08",
            "wrong_bulletin": False,
        },
    )

    result = process_bulletins(parish_name="Test Parish")
    assert result["processed_bulletins"] == 1

    events = json.loads((tmp_path / "events.json").read_text(encoding="utf-8"))
    assert [e["bulletin_source_url"] for e in events] == ["https://example.org/current.pdf"]
    assert events[0]["day_of_week"] == "Sunday"


def test_process_serves_cached_extraction_without_api_call(
    monkeypatch, tmp_path: Path,
) -> None:
    """A re-run after a metadata reset reuses the on-disk result cache."""
    db_path = _setup_test_db(tmp_path)
    _patch_process_paths(monkeypatch, tmp_path)
    monkeypatch.setattr("pdf_extract.process.connect_db", lambda: connect_db(db_path))

    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"fake")

    def _metadata_entry():
        return {
            "parish_slug": "test-parish",
            "source_url": "https://example.org/parsed.pdf",
            "pdf_path": str(pdf_path),
            "content_hash": "def",
            "fetched_at": "2026-01-01T00:00:00Z",
            "processed_at": None,
            "published_date": None,
        }

    save_json_list(tmp_path / "metadata.json", [_metadata_entry()])

    extract_calls = 0

    def _extract_events(pdf_bytes, *, churches, model="gemini-3-flash-preview", today=None):
        nonlocal extract_calls
        extract_calls += 1
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
                    "note": None,
                }
            ],
            "church_list_needs_review": False,
            "published_date": None,
            "wrong_bulletin": False,
        }

    monkeypatch.setattr("pdf_extract.classifiers.gemini.extract_events", _extract_events)

    first = process_bulletins(parish_name="Test Parish")
    assert first["processed_bulletins"] == 1
    assert first["cache_hits"] == 0
    assert extract_calls == 1

    # Simulate a metadata reset: processed_at cleared, same bulletin content.
    save_json_list(tmp_path / "metadata.json", [_metadata_entry()])

    second = process_bulletins(parish_name="Test Parish")
    assert second["processed_bulletins"] == 1
    assert second["inserted_events"] == 1
    assert second["cache_hits"] == 1
    assert extract_calls == 1, "cache hit must not call the classifier again"
