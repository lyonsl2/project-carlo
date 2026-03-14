"""Create and populate the database from schema.sql and data files."""

from __future__ import annotations

import csv
import logging
from pathlib import Path

from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    CHURCHES_CSV_PATH,
    DEFAULT_DB_PATH,
    DETECT_RESULTS_PATH,
    EVENTS_PATH,
    GEOCODE_RESULTS_PATH,
    SCHEMA_PATH,
    VERIFY_RESULTS_PATH,
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

        # 5. Load churches from CSV + verify_results.json + geocode_results.json
        stats["churches"] = _load_churches(conn)

        # 6. Load events.json → event table
        stats["events"] = _load_events(conn)

        conn.commit()
        LOGGER.info("Database created: %s", stats)
        return stats
    finally:
        conn.close()


def _load_websites(conn) -> int:
    from pdf_extract.storage import PARISHES_CSV_PATH

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
    """Load churches from CSV, then apply verify and geocode results."""
    now = utc_now_iso()
    count = 0

    # Step A: Load from churches.csv
    if CHURCHES_CSV_PATH.exists():
        with open(CHURCHES_CSV_PATH, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                parish_row = conn.execute(
                    "SELECT id FROM parish WHERE slug = ?", (row["parish_id"],)
                ).fetchone()
                if not parish_row:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO church(parish_id, name, address, created_at) VALUES (?, ?, ?, ?)",
                    (parish_row["id"], row["name"], row.get("address"), now),
                )
                count += 1
        LOGGER.info("Loaded %d churches from churches.csv", count)
    else:
        LOGGER.info("No churches.csv found, skipping")

    # Step B: Apply verify_results.json
    verify_results = load_json_dict(VERIFY_RESULTS_PATH)
    verified_count = 0
    for parish_slug, result in verify_results.items():
        parish_row = conn.execute(
            "SELECT id FROM parish WHERE slug = ?", (parish_slug,)
        ).fetchone()
        if not parish_row:
            continue

        # Process existing church verifications
        for church_v in result.get("existing_churches", []):
            church_name = church_v.get("church_name")
            if not church_name:
                continue

            name_verified = 1 if church_v.get("name_status") == "verified" else 0
            address_verified = 1 if church_v.get("address_status") == "verified" else 0

            # If incorrect and correction provided, update the name/address
            if church_v.get("name_status") == "incorrect" and church_v.get("corrected_name"):
                conn.execute(
                    "UPDATE church SET name = ?, name_verified = 1 WHERE parish_id = ? AND name = ?",
                    (church_v["corrected_name"], parish_row["id"], church_name),
                )
            else:
                conn.execute(
                    "UPDATE church SET name_verified = ? WHERE parish_id = ? AND name = ?",
                    (name_verified, parish_row["id"], church_name),
                )

            if church_v.get("address_status") == "incorrect" and church_v.get("corrected_address"):
                # Use the potentially-corrected name for lookup
                lookup_name = church_v.get("corrected_name") or church_name
                conn.execute(
                    "UPDATE church SET address = ?, address_verified = 1 WHERE parish_id = ? AND name = ?",
                    (church_v["corrected_address"], parish_row["id"], lookup_name),
                )
            else:
                lookup_name = church_v.get("corrected_name") or church_name
                conn.execute(
                    "UPDATE church SET address_verified = ? WHERE parish_id = ? AND name = ?",
                    (address_verified, parish_row["id"], lookup_name),
                )

            verified_count += 1

        # Insert new churches discovered by verify
        for new_church in result.get("new_churches", []):
            if not new_church.get("name"):
                continue
            conn.execute(
                "INSERT OR IGNORE INTO church(parish_id, name, address, created_at) VALUES (?, ?, ?, ?)",
                (parish_row["id"], new_church["name"], new_church.get("address"), now),
            )
            count += 1

    if verified_count:
        LOGGER.info("Applied %d church verifications from verify_results.json", verified_count)

    # Step C: Apply geocode_results.json
    geocode_results = load_json_list(GEOCODE_RESULTS_PATH)
    geocoded_count = 0
    for geo in geocode_results:
        parish_row = conn.execute(
            "SELECT id FROM parish WHERE slug = ?", (geo["parish_slug"],)
        ).fetchone()
        if not parish_row:
            continue
        conn.execute(
            "UPDATE church SET latitude = ?, longitude = ? WHERE parish_id = ? AND name = ?",
            (geo["latitude"], geo["longitude"], parish_row["id"], geo["church_name"]),
        )
        geocoded_count += 1

    if geocoded_count:
        LOGGER.info("Applied %d geocode results from geocode_results.json", geocoded_count)

    return count


def _load_events(conn) -> int:
    entries = load_json_list(EVENTS_PATH)
    if not entries:
        LOGGER.info("No events.json found, skipping")
        return 0

    count = 0
    for entry in entries:
        parish_row = conn.execute("SELECT id FROM parish WHERE slug = ?", (entry["parish_slug"],)).fetchone()
        if not parish_row:
            continue
        church_row = conn.execute(
            "SELECT id FROM church WHERE parish_id = ? AND name = ?",
            (parish_row["id"], entry["church_name"]),
        ).fetchone()
        if not church_row:
            continue

        # Resolve bulletin_id if we can find it
        bulletin_id = None
        bulletin_row = conn.execute(
            "SELECT id FROM bulletin WHERE parish_id = ? AND source_url = ?",
            (parish_row["id"], entry.get("bulletin_source_url")),
        ).fetchone()
        if bulletin_row:
            bulletin_id = bulletin_row["id"]

        conn.execute(
            """INSERT INTO event(church_id, bulletin_id, event_type, event_kind, day_of_week, date, start_time, end_time, cancelled, raw_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                church_row["id"],
                bulletin_id,
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

        count += 1

    LOGGER.info("Loaded %d events from events.json", count)
    return count
