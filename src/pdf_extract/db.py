"""Create and populate the database from schema.sql and data files."""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path

from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    CHURCHES_PATH,
    DEFAULT_DB_PATH,
    DETECT_RESULTS_PATH,
    EVENTS_PATH,
    PARISHES_CSV_PATH,
    SCHEMA_PATH,
    connect_db,
    delete_db,
    load_json_dict,
    load_json_list,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)


def create_db(db_path: Path = DEFAULT_DB_PATH) -> dict[str, int]:
    """Drop and recreate the database from schema + data files.

    Each load step is idempotent and skipped if its source file is missing.
    """
    LOGGER.info("Creating database at %s", db_path)
    delete_db(db_path)
    conn = connect_db(db_path)
    try:
        # 1. Create schema
        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        conn.executescript(schema_sql)
        LOGGER.info("Schema created")

        stats: dict[str, int] = {}

        # 2. Load parishes.csv → website table
        stats["websites"] = _load_websites(conn)

        # 3. Load detect_results.json → enrich website + create parish rows
        stats["parishes"] = _load_detect_results_and_seed_parishes(conn)

        # 4. Load bulletins/metadata.json → bulletin table
        stats["bulletins"] = _load_bulletins(conn)

        # 5. Load churches.json → church table
        stats["churches"] = _load_churches(conn)

        # 6. Load events.json → event + bulletin_event tables
        stats["events"] = _load_events(conn)

        conn.commit()
        LOGGER.info("Database created: %s", stats)
        return stats
    finally:
        conn.close()


def _load_websites(conn) -> int:
    if not PARISHES_CSV_PATH.exists():
        LOGGER.info("No parishes.csv found, skipping website load")
        return 0
    count = 0
    with open(PARISHES_CSV_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            conn.execute(
                "INSERT OR IGNORE INTO website(slug, name, homepage_url) VALUES (?, ?, ?)",
                (row["slug"], row["name"], row["website"]),
            )
            count += 1
    LOGGER.info("Loaded %d websites from parishes.csv", count)
    return count


def _load_detect_results_and_seed_parishes(conn) -> int:
    results = load_json_dict(DETECT_RESULTS_PATH)
    if not results:
        LOGGER.info("No detect_results.json found, skipping")
        return 0

    # Update website rows with detection data
    for slug, info in results.items():
        conn.execute(
            """UPDATE website
               SET bulletin_provider = ?, provider_id = ?, bulletin_page = ?
               WHERE slug = ?""",
            (info.get("bulletin_provider"), info.get("provider_id"), info.get("bulletin_page"), slug),
        )

    # Create parish rows from websites with supported providers
    rows = conn.execute(
        """SELECT slug, name, homepage_url, bulletin_provider, provider_id
           FROM website
           WHERE bulletin_provider IN ('ecatholic', 'parishes_online')"""
    ).fetchall()

    count = 0
    now = utc_now_iso()
    for row in rows:
        provider = row["bulletin_provider"]
        if provider == "ecatholic":
            source_type = "ecatholic"
            source_provider_id = row["homepage_url"]
        elif provider == "parishes_online":
            source_type = "parishes-online"
            source_provider_id = row["provider_id"]
        else:
            continue

        if not source_provider_id:
            LOGGER.warning("Skipping %s: no provider_id", row["slug"])
            continue

        conn.execute(
            "INSERT OR IGNORE INTO parish(slug, name, source_type, source_provider_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (row["slug"], row["name"], source_type, source_provider_id, now),
        )
        count += 1

    LOGGER.info("Seeded %d parishes from detect results", count)
    return count


def _load_bulletins(conn) -> int:
    entries = load_json_list(BULLETINS_METADATA_PATH)
    if not entries:
        LOGGER.info("No bulletins/metadata.json found, skipping")
        return 0

    count = 0
    for entry in entries:
        parish_row = conn.execute("SELECT id FROM parish WHERE slug = ?", (entry["parish_slug"],)).fetchone()
        if not parish_row:
            continue
        conn.execute(
            """INSERT OR IGNORE INTO bulletin(parish_id, source_url, pdf_path, published_date, fetched_at, processed_at, content_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                parish_row["id"],
                entry["source_url"],
                entry.get("pdf_path"),
                entry.get("published_date"),
                entry.get("fetched_at"),
                entry.get("processed_at"),
                entry.get("content_hash"),
            ),
        )
        count += 1

    LOGGER.info("Loaded %d bulletins from metadata.json", count)
    return count


def _load_churches(conn) -> int:
    entries = load_json_list(CHURCHES_PATH)
    if not entries:
        LOGGER.info("No churches.json found, skipping")
        return 0

    count = 0
    now = utc_now_iso()
    for entry in entries:
        parish_row = conn.execute("SELECT id FROM parish WHERE slug = ?", (entry["parish_slug"],)).fetchone()
        if not parish_row:
            continue
        conn.execute(
            """INSERT OR IGNORE INTO church(parish_id, name, address, name_normalized, latitude, longitude, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                parish_row["id"],
                entry.get("name"),
                entry.get("address"),
                entry.get("name_normalized"),
                entry.get("latitude"),
                entry.get("longitude"),
                now,
            ),
        )
        count += 1

    LOGGER.info("Loaded %d churches from churches.json", count)
    return count


def _load_events(conn) -> int:
    entries = load_json_list(EVENTS_PATH)
    if not entries:
        LOGGER.info("No events.json found, skipping")
        return 0

    count = 0
    for entry in entries:
        # Resolve church_id via parish_slug + church_name_normalized
        parish_row = conn.execute("SELECT id FROM parish WHERE slug = ?", (entry["parish_slug"],)).fetchone()
        if not parish_row:
            continue
        church_row = conn.execute(
            "SELECT id FROM church WHERE parish_id = ? AND name_normalized = ?",
            (parish_row["id"], entry["church_name_normalized"]),
        ).fetchone()
        if not church_row:
            continue

        cur = conn.execute(
            """INSERT INTO event(church_id, event_type, event_kind, day_of_week, date, start_time, end_time, cancelled, raw_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                church_row["id"],
                entry.get("event_type", ""),
                entry.get("event_kind", ""),
                entry.get("day_of_week"),
                entry.get("date"),
                entry.get("start_time", ""),
                entry.get("end_time"),
                int(entry.get("cancelled", False)),
                entry.get("raw_json"),
            ),
        )

        # Link to bulletin if we can find it
        bulletin_row = conn.execute(
            "SELECT id FROM bulletin WHERE parish_id = ? AND source_url = ?",
            (parish_row["id"], entry.get("bulletin_source_url")),
        ).fetchone()
        if bulletin_row:
            conn.execute(
                "INSERT OR IGNORE INTO bulletin_event(bulletin_id, event_id) VALUES (?, ?)",
                (bulletin_row["id"], cur.lastrowid),
            )

        count += 1

    LOGGER.info("Loaded %d events from events.json", count)
    return count
