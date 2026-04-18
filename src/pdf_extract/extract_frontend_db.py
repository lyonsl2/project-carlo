"""Extract a minimal SQLite database for the frontend from parish_events.db.

Only the church and event tables are copied, with columns stripped down to what
the web app actually needs.  The output is written to apps/web/public/frontend.db
so Vite can serve it as a static asset.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from pdf_extract.storage import configure_sqlite_connection

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DB = ROOT / "data" / "parish_events.db"
DEST_DB = ROOT / "apps" / "web" / "public" / "frontend.db"
FRONTEND_SCHEMA_PATH = ROOT / "data" / "frontend_schema.sql"


def extract(source: Path = SOURCE_DB, dest: Path = DEST_DB) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Source database not found: {source}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.unlink(missing_ok=True)

    src = sqlite3.connect(source)
    configure_sqlite_connection(src)
    dst = sqlite3.connect(dest)
    configure_sqlite_connection(dst)
    try:
        dst.executescript(FRONTEND_SCHEMA_PATH.read_text(encoding="utf-8"))

        churches = src.execute(
            """
            SELECT c.id, c.parish_id, c.slug, c.name, c.address_line1, c.address_line2,
                   c.city, c.state, c.postal_code, c.latitude, c.longitude,
                   p.homepage_url,
                   (SELECT b.source_url FROM bulletin b
                    WHERE b.parish_id = c.parish_id AND b.source_url IS NOT NULL
                    ORDER BY COALESCE(b.published_date, '') DESC,
                             COALESCE(b.fetched_at, '') DESC,
                             COALESCE(b.processed_at, '') DESC, b.id DESC
                    LIMIT 1)
            FROM church c
            LEFT JOIN parish p ON c.parish_id = p.id
            """
        ).fetchall()
        dst.executemany(
            "INSERT INTO church VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            churches,
        )

        events = src.execute(
            """
            SELECT e.id, e.church_id, e.event_type, e.event_kind,
                   e.day_of_week, e.date, e.start_time, e.end_time, e.cancelled,
                   e.page_number
            FROM event e
            INNER JOIN bulletin b ON e.bulletin_id = b.id
            INNER JOIN (
                SELECT parish_id, id,
                       ROW_NUMBER() OVER (
                           PARTITION BY parish_id
                           ORDER BY COALESCE(published_date, '') DESC,
                                    COALESCE(fetched_at, '') DESC,
                                    COALESCE(processed_at, '') DESC,
                                    id DESC
                       ) AS rn
                FROM bulletin
            ) latest ON b.parish_id = latest.parish_id AND b.id = latest.id AND latest.rn = 1
            """
        ).fetchall()
        dst.executemany(
            "INSERT INTO event VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", events
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
