import json
from pathlib import Path

from pdf_extract.storage import connect_db, get_parish_id, insert_bulletin, migrate_db
from pdf_extract.sync import BulletinLink, extract_bulletin_text, fetch_bulletins, parse_bulletin_events


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


def test_extract_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
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
            source_url="https://example.org/sample.pdf",
            pdf_path=str(pdf_path),
            published_date="2026-02-22",
            content_hash="abc",
        )
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setattr("pdf_extract.sync.extract_text_by_page", lambda _: ["Page One", "Page Two"])
    monkeypatch.setattr(
        "pdf_extract.sync.extract_markdown_with_docling",
        lambda _: "# Bulletin\n\n- Item",
    )

    first = extract_bulletin_text(parish_name="Southeast Rochester Catholic Community")
    second = extract_bulletin_text(parish_name="Southeast Rochester Catholic Community")

    assert first["extracted_bulletins"] == 1
    assert second["extracted_bulletins"] == 0

    conn = connect_db(db_path)
    try:
        row = conn.execute(
            "SELECT text_pages_json, markdown_text FROM bulletin WHERE source_url = ?",
            ("https://example.org/sample.pdf",),
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    assert row["text_pages_json"] == json.dumps(["Page One", "Page Two"])
    assert row["markdown_text"] == "# Bulletin\n\n- Item"


def test_parse_stage_is_idempotent(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    _patch_sync_db(monkeypatch, db_path)

    conn = connect_db(db_path)
    try:
        parish_id = get_parish_id(conn, "Southeast Rochester Catholic Community")
        bulletin_id = insert_bulletin(
            conn,
            parish_id=parish_id,
            source_url="https://example.org/parsed.pdf",
            pdf_path=str(tmp_path / "parsed.pdf"),
            published_date="2026-02-22",
            text_pages_json=json.dumps(["Page One", "Page Two"]),
            content_hash="def",
        )
        conn.execute(
            "UPDATE bulletin SET text_extracted_at = '2026-02-22T00:00:00Z' WHERE id = ?",
            (bulletin_id,),
        )
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setattr(
        "pdf_extract.sync.extract_events",
        lambda text, model="gpt-5-nano": {
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

    first = parse_bulletin_events(parish_name="Southeast Rochester Catholic Community")
    second = parse_bulletin_events(parish_name="Southeast Rochester Catholic Community")

    assert first["parsed_bulletins"] == 1
    assert first["inserted_events"] == 1
    assert second["parsed_bulletins"] == 0
    assert second["inserted_events"] == 0
