"""Extract a minimal SQLite database for the frontend from parish_events.db.

Only the church and event tables are copied, with columns stripped down to what
the web app actually needs.  The output is written to apps/web/public/frontend.db
so Vite can serve it as a static asset.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DB = ROOT / "data" / "parish_events.db"
DEST_DB = ROOT / "apps" / "web" / "public" / "frontend.db"


def extract(source: Path = SOURCE_DB, dest: Path = DEST_DB) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Source database not found: {source}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.unlink(missing_ok=True)

    src = sqlite3.connect(source)
    dst = sqlite3.connect(dest)
    try:
        dst.execute(
            """
            CREATE TABLE church (
                id INTEGER PRIMARY KEY,
                parish_id INTEGER NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                name TEXT,
                address_line1 TEXT,
                address_line2 TEXT,
                city TEXT,
                state TEXT,
                postal_code TEXT,
                latitude REAL,
                longitude REAL
            )
            """
        )
        dst.execute("CREATE INDEX idx_church_slug ON church(slug)")
        dst.execute(
            """
            CREATE TABLE event (
                id INTEGER PRIMARY KEY,
                church_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                event_kind TEXT NOT NULL,
                day_of_week TEXT,
                date TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                cancelled INTEGER NOT NULL
            )
            """
        )
        dst.execute("CREATE INDEX idx_event_church ON event(church_id)")
        dst.execute("CREATE INDEX idx_event_type ON event(event_type)")

        churches = src.execute(
            "SELECT id, parish_id, slug, name, address_line1, address_line2, city, state,"
            " postal_code, latitude, longitude FROM church"
        ).fetchall()
        dst.executemany(
            "INSERT INTO church VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", churches
        )

        events = src.execute(
            """
            SELECT id, church_id, event_type, event_kind,
                   day_of_week, date, start_time, end_time, cancelled
            FROM event
            """
        ).fetchall()
        dst.executemany(
            "INSERT INTO event VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", events
        )

        dst.commit()
        dst.execute("VACUUM")

        church_count = dst.execute("SELECT count(*) FROM church").fetchone()[0]
        event_count = dst.execute("SELECT count(*) FROM event").fetchone()[0]
        size_kb = dest.stat().st_size / 1024
        print(
            f"frontend.db: {church_count} churches, {event_count} events, {size_kb:.1f} KB"
        )
    finally:
        src.close()
        dst.close()


if __name__ == "__main__":
    extract()
