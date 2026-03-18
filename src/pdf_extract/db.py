"""Create and populate the database from schema.sql and data files."""

from __future__ import annotations

import csv
import logging
import re
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


def _time_to_minutes(s: str | None) -> int | None:
    """Parse time string (h:MM AM/PM, a.m./p.m., etc.) to minutes since midnight.

    Returns None for null/empty. Handles: 8:00 AM, 5:30pm, 8:00 a.m., midnight, noon.
    """
    if s is None or not isinstance(s, str):
        return None
    raw = s.strip()
    if not raw:
        return None

    # Normalize a.m. / p.m. to AM / PM
    raw = re.sub(r"a\.m\.?(?=\s|$)", "AM", raw, flags=re.I)
    raw = re.sub(r"p\.m\.?(?=\s|$)", "PM", raw, flags=re.I)

    if re.match(r"^midnight$", raw, re.I):
        return 0
    if re.match(r"^noon$", raw, re.I):
        return 720

    m = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", raw, re.I)
    if m:
        h = int(m[1])
        mins = int(m[2])
        ampm = m[3].upper()
        if ampm == "PM" and h != 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        return h * 60 + mins

    m = re.match(r"^(\d{1,2})\s*(AM|PM)$", raw, re.I)
    if m:
        h = int(m[1])
        ampm = m[2].upper()
        if ampm == "PM" and h != 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        return h * 60

    m = re.match(r"^(\d{1,2}):(\d{2})$", raw)
    if m:
        h, mins = int(m[1]), int(m[2])
        if 0 <= h <= 23 and 0 <= mins <= 59:
            return h * 60 + mins

    m = re.match(r"^(\d{2})(\d{2})$", raw)
    if m:
        h, mins = int(m[1]), int(m[2])
        if 0 <= h <= 23 and 0 <= mins <= 59:
            return h * 60 + mins

    return None


def _validate_csv_headers(
    fieldnames: list[str] | None, required: set[str], filename: str,
) -> None:
    """Raise ValueError if required CSV columns are missing."""
    if fieldnames is None:
        raise ValueError(f"{filename}: CSV file is empty or has no header row")
    missing = required - set(fieldnames)
    if missing:
        raise ValueError(f"{filename}: missing required columns: {sorted(missing)}")


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
        reader = csv.DictReader(f)
        _validate_csv_headers(reader.fieldnames, {"slug", "name", "website"}, "parishes.csv")
        for row in reader:
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
    count = _load_churches_from_csv(conn)
    _apply_verify_results(conn)
    _apply_geocode_results(conn)
    return count


def _load_churches_from_csv(conn) -> int:
    """Insert churches from churches.csv into the database."""
    if not CHURCHES_CSV_PATH.exists():
        LOGGER.info("No churches.csv found, skipping")
        return 0

    now = utc_now_iso()
    count = 0
    with open(CHURCHES_CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        _validate_csv_headers(
            reader.fieldnames,
            {"parish_id", "slug", "name", "line1", "city", "state", "postal_code"},
            "churches.csv",
        )
        for row in reader:
            parish_row = conn.execute(
                "SELECT id FROM parish WHERE slug = ?", (row["parish_id"],)
            ).fetchone()
            if not parish_row:
                continue
            cursor = conn.execute(
                """INSERT OR IGNORE INTO church(
                    parish_id, slug, name, address_line1, address_line2, city, state, postal_code,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    parish_row["id"],
                    row["slug"],
                    row["name"],
                    row.get("line1") or None,
                    row.get("line2") or None,
                    row.get("city") or None,
                    row.get("state") or None,
                    row.get("postal_code") or None,
                    now,
                ),
            )
            if cursor.rowcount > 0:
                count += 1
    LOGGER.info("Loaded %d churches from churches.csv", count)
    return count


def _apply_verify_results(conn) -> int:
    """Apply verify_results.json: update verified names/addresses, insert new churches."""
    verify_results = load_json_dict(VERIFY_RESULTS_PATH)
    if not verify_results:
        return 0

    now = utc_now_iso()
    verified_count = 0
    new_count = 0

    for parish_slug, result in verify_results.items():
        parish_row = conn.execute(
            "SELECT id FROM parish WHERE slug = ?", (parish_slug,)
        ).fetchone()
        if not parish_row:
            continue

        for church_v in result.get("existing_churches", []):
            church_slug = church_v.get("church_slug")
            if not church_slug:
                continue

            if church_v.get("slug_needs_review"):
                LOGGER.warning(
                    "Church slug may need review: %s (parish: %s)",
                    church_slug, parish_slug,
                )

            name_verified = 1 if church_v.get("name_status") == "verified" else 0
            address_verified = 1 if church_v.get("address_status") == "verified" else 0

            if church_v.get("name_status") == "incorrect" and church_v.get("corrected_name"):
                conn.execute(
                    "UPDATE church SET name = ?, name_verified = 1 WHERE slug = ?",
                    (church_v["corrected_name"], church_slug),
                )
            else:
                conn.execute(
                    "UPDATE church SET name_verified = ? WHERE slug = ?",
                    (name_verified, church_slug),
                )

            if church_v.get("address_status") == "incorrect" and church_v.get("corrected_address"):
                addr = church_v["corrected_address"]
                if isinstance(addr, dict):
                    conn.execute(
                        """UPDATE church SET address_line1 = ?, address_line2 = ?,
                           city = ?, state = ?, postal_code = ?, address_verified = 1
                           WHERE slug = ?""",
                        (
                            addr.get("line1"), addr.get("line2"),
                            addr.get("city"), addr.get("state"), addr.get("postal_code"),
                            church_slug,
                        ),
                    )
                else:
                    conn.execute(
                        "UPDATE church SET address_verified = 1 WHERE slug = ?",
                        (church_slug,),
                    )
            else:
                conn.execute(
                    "UPDATE church SET address_verified = ? WHERE slug = ?",
                    (address_verified, church_slug),
                )

            verified_count += 1

        for new_church in result.get("new_churches", []):
            if not new_church.get("name"):
                continue
            new_slug = new_church.get("slug")
            if not new_slug:
                LOGGER.warning(
                    "Skipping new church without slug: %s (parish: %s)",
                    new_church.get("name"), parish_slug,
                )
                continue
            addr = new_church.get("address")
            if isinstance(addr, dict):
                conn.execute(
                    """INSERT OR IGNORE INTO church(
                        parish_id, slug, name,
                        address_line1, address_line2, city, state, postal_code,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        parish_row["id"], new_slug, new_church["name"],
                        addr.get("line1"), addr.get("line2"),
                        addr.get("city"), addr.get("state"), addr.get("postal_code"),
                        now,
                    ),
                )
            else:
                conn.execute(
                    """INSERT OR IGNORE INTO church(parish_id, slug, name, created_at)
                       VALUES (?, ?, ?, ?)""",
                    (parish_row["id"], new_slug, new_church["name"], now),
                )
            new_count += 1

    if verified_count:
        LOGGER.info("Applied %d church verifications from verify_results.json", verified_count)
    if new_count:
        LOGGER.info("Inserted %d new churches from verify_results.json", new_count)
    return verified_count


def _apply_geocode_results(conn) -> int:
    """Apply geocode_results.json: set lat/lng on churches by structured address key."""
    from pdf_extract.address import address_key

    geocode_results = load_json_list(GEOCODE_RESULTS_PATH)
    if not geocode_results:
        return 0

    # Build lookup: address_key -> (lat, lng)
    geo_lookup: dict[str, tuple[float, float]] = {}
    for geo in geocode_results:
        lat = geo.get("latitude")
        lng = geo.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            LOGGER.warning(
                "Skipping geocode entry: non-numeric coordinates (lat=%r, lng=%r)", lat, lng,
            )
            continue
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            LOGGER.warning(
                "Skipping geocode entry: coordinates out of range (lat=%s, lng=%s)", lat, lng,
            )
            continue
        key = address_key(
            geo.get("line1"), geo.get("line2"),
            geo.get("city"), geo.get("state"), geo.get("postal_code"),
        )
        geo_lookup[key] = (lat, lng)

    # Query all churches and match by address key
    churches = conn.execute(
        "SELECT id, address_line1, address_line2, city, state, postal_code FROM church"
    ).fetchall()

    geocoded_count = 0
    for church in churches:
        key = address_key(
            church["address_line1"], church["address_line2"],
            church["city"], church["state"], church["postal_code"],
        )
        if key in geo_lookup:
            lat, lng = geo_lookup[key]
            conn.execute(
                "UPDATE church SET latitude = ?, longitude = ? WHERE id = ?",
                (lat, lng, church["id"]),
            )
            geocoded_count += 1

    if geocoded_count:
        LOGGER.info("Applied %d geocode results from geocode_results.json", geocoded_count)
    return geocoded_count


def _load_events(conn) -> int:
    entries = load_json_list(EVENTS_PATH)
    if not entries:
        LOGGER.info("No events.json found, skipping")
        return 0

    count = 0
    for entry in entries:
        church_slug = entry.get("church_slug")
        if not church_slug:
            continue
        church_row = conn.execute(
            "SELECT id, parish_id FROM church WHERE slug = ?", (church_slug,)
        ).fetchone()
        if not church_row:
            continue

        # Resolve bulletin_id if we can find it
        bulletin_id = None
        bulletin_row = conn.execute(
            "SELECT id FROM bulletin WHERE parish_id = ? AND source_url = ?",
            (church_row["parish_id"], entry.get("bulletin_source_url")),
        ).fetchone()
        if bulletin_row:
            bulletin_id = bulletin_row["id"]

        start_minutes = _time_to_minutes(entry.get("start_time"))
        if start_minutes is None:
            LOGGER.warning(
                "Skipping event: unparseable start_time %r (church=%s)",
                entry.get("start_time"), church_slug,
            )
            continue

        end_minutes = _time_to_minutes(entry.get("end_time"))

        conn.execute(
            """INSERT INTO event(church_id, bulletin_id, event_type, event_kind, day_of_week, date, start_time, end_time, cancelled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                church_row["id"],
                bulletin_id,
                entry.get("event_type", ""),
                entry.get("event_kind", ""),
                entry.get("day_of_week"),
                entry.get("date"),
                start_minutes,
                end_minutes,
                int(entry.get("cancelled", False)),
            ),
        )

        count += 1

    LOGGER.info("Loaded %d events from events.json", count)
    return count
