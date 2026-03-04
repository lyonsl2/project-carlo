from pathlib import Path

from pdf_extract.storage import (
    connect_db,
    get_parish_id,
    insert_bulletin,
    insert_bulletin_event,
    insert_church,
    insert_event,
    migrate_db,
)


def test_event_belongs_to_church_and_maps_to_bulletin(tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    conn = connect_db(db_path)
    try:
        parish_id = get_parish_id(conn, "Southeast Rochester Catholic Community")
        church_id = insert_church(
            conn,
            parish_id=parish_id,
            name="Blessed Sacrament",
            address="534 Oxford St.",
            name_normalized="blessed sacrament",
        )
        bulletin_id = insert_bulletin(
            conn,
            parish_id=parish_id,
            source_url="https://files.ecatholic.com/19887/bulletins/20260222.pdf",
            published_date="2026-02-22",
            content_hash="abc",
        )
        event_id = insert_event(
            conn,
            church_id=church_id,
            event_type="mass",
            event_kind="weekly",
            day_of_week="Sunday",
            date=None,
            start_time="9:30am",
            end_time=None,
            cancelled=False,
            raw_json="{}",
        )
        insert_bulletin_event(conn, bulletin_id=bulletin_id, event_id=event_id)
        conn.commit()

        row = conn.execute(
            """
            SELECT e.id as event_id, c.id as church_id, b.id as bulletin_id
            FROM event e
            JOIN church c ON c.id = e.church_id
            JOIN bulletin_event be ON be.event_id = e.id
            JOIN bulletin b ON b.id = be.bulletin_id
            WHERE e.id = ?
            """,
            (event_id,),
        ).fetchone()
        assert row is not None
        assert int(row["church_id"]) == church_id
        assert int(row["bulletin_id"]) == bulletin_id
    finally:
        conn.close()
