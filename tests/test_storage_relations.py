from pathlib import Path

from pdf_extract.storage import SCHEMA_PATH, connect_db


def test_event_belongs_to_church_and_bulletin(tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    conn = connect_db(db_path)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)

    # Insert test data
    conn.execute(
        "INSERT INTO parish(slug, name, source_type, source_provider_id, created_at) VALUES (?, ?, ?, ?, ?)",
        ("test-parish", "Test Parish", "ecatholic", "https://test.org", "2026-01-01T00:00:00Z"),
    )
    parish_id = conn.execute("SELECT id FROM parish WHERE slug = 'test-parish'").fetchone()["id"]

    conn.execute(
        "INSERT INTO church(parish_id, slug, name, address_line1, city, state, postal_code, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (parish_id, "blessed-sacrament", "Blessed Sacrament", "534 Oxford St.", "Rochester", "NY", "14607",
         "2026-01-01T00:00:00Z"),
    )
    church_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute(
        "INSERT INTO bulletin(parish_id, source_url, published_date, content_hash, fetched_at) VALUES (?, ?, ?, ?, ?)",
        (parish_id, "https://files.ecatholic.com/19887/bulletins/20260222.pdf", "2026-02-22", "abc", "2026-01-01T00:00:00Z"),
    )
    bulletin_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute(
        "INSERT INTO event(church_id, bulletin_id, event_type, event_kind, day_of_week, start_time, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (church_id, bulletin_id, "mass", "weekly", "Sunday", "9:30am", 0),
    )
    event_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()

    row = conn.execute(
        """
        SELECT e.id as event_id, c.id as church_id, b.id as bulletin_id
        FROM event e
        JOIN church c ON c.id = e.church_id
        JOIN bulletin b ON b.id = e.bulletin_id
        WHERE e.id = ?
        """,
        (event_id,),
    ).fetchone()
    assert row is not None
    assert int(row["church_id"]) == church_id
    assert int(row["bulletin_id"]) == bulletin_id
    conn.close()
