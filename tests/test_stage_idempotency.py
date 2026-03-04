from pathlib import Path

from pdf_extract.storage import connect_db, get_parish_id, insert_bulletin, migrate_db
from pdf_extract.sync import BulletinLink, fetch_bulletins, process_bulletins


def _patch_sync_db(monkeypatch, db_path: Path) -> None:
    monkeypatch.setattr("pdf_extract.sync.migrate_db", lambda: None)
    monkeypatch.setattr("pdf_extract.sync.connect_db", lambda: connect_db(db_path))


def test_fetch_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    _patch_sync_db(monkeypatch, db_path)

    monkeypatch.setattr(
        "pdf_extract.sync._build_latest_bulletin_links_for_parish",
        lambda **kwargs: BulletinLink(
            source_url="https://example.org/bulletin.pdf",
            fetch_url="https://example.org/bulletin.pdf",
        ),
    )
    monkeypatch.setattr("pdf_extract.sync._download_pdf", lambda **kwargs: b"%PDF-1.4 fake")

    pdf_dir = tmp_path / "bulletins"
    first = fetch_bulletins(
        parish_name="Southeast Rochester Catholic Community",
        pdf_dir=pdf_dir,
    )
    second = fetch_bulletins(
        parish_name="Southeast Rochester Catholic Community",
        pdf_dir=pdf_dir,
    )

    assert first["fetched_bulletins"] == 1
    assert second["fetched_bulletins"] == 0
    assert second["skipped_existing_urls"] == 1


def test_process_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    _patch_sync_db(monkeypatch, db_path)

    conn = connect_db(db_path)
    try:
        parish_id = get_parish_id(conn, "Southeast Rochester Catholic Community")
        pdf_path = tmp_path / "sample.pdf"
        pdf_path.write_bytes(b"fake")
        insert_bulletin(
            conn,
            parish_id=parish_id,
            source_url="https://example.org/parsed.pdf",
            pdf_path=str(pdf_path),
            published_date="2026-02-22",
            content_hash="def",
        )
        conn.commit()
    finally:
        conn.close()

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

    first = process_bulletins(parish_name="Southeast Rochester Catholic Community")
    second = process_bulletins(parish_name="Southeast Rochester Catholic Community")

    assert first["processed_bulletins"] == 1
    assert first["inserted_events"] == 1
    assert second["processed_bulletins"] == 0
    assert second["inserted_events"] == 0

    conn = connect_db(db_path)
    try:
        row = conn.execute(
            "SELECT processed_at FROM bulletin WHERE source_url = ?",
            ("https://example.org/parsed.pdf",),
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    assert row["processed_at"] is not None
