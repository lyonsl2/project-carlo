"""Backfill church latitude/longitude from address using Nominatim."""

from __future__ import annotations

import json
import logging
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import csv

from pdf_extract.address import address_key, format_address
from pdf_extract.storage import (
    CHURCHES_CSV_PATH,
    GEOCODE_RESULTS_PATH,
    connect_db,
    save_json_list,
)

LOGGER = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def geocode_address(address: str, *, email: str | None = None) -> tuple[float, float] | None:
    params = {"format": "jsonv2", "q": address, "limit": 1}
    if email:
        params["email"] = email
    url = f"{NOMINATIM_URL}?{urlencode(params)}"
    req = Request(
        url,
        headers={
            "User-Agent": "project-carlo-geocoder/0.1 (+https://github.com/lyonsl2/project-carlo)",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list) or not payload:
        return None
    first = payload[0]
    if not isinstance(first, dict):
        return None
    lat_raw = first.get("lat")
    lon_raw = first.get("lon")
    if not isinstance(lat_raw, str) or not isinstance(lon_raw, str):
        return None
    return float(lat_raw), float(lon_raw)


def run_backfill(
    *,
    dry_run: bool,
    limit: int | None,
    pause_seconds: float,
    email: str | None,
) -> dict[str, int]:
    geocode_results: list[dict] = []

    # Read churches.csv to find already-geocoded address keys
    already_geocoded: set[str] = set()
    if CHURCHES_CSV_PATH.exists():
        with open(CHURCHES_CSV_PATH, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if (row.get("latitude") or "").strip() and (row.get("longitude") or "").strip():
                    key = address_key(
                        row.get("line1"), row.get("line2"),
                        row.get("city"), row.get("state"), row.get("postal_code"),
                    )
                    already_geocoded.add(key)

    # Query churches with non-null address from DB, skip already-geocoded
    conn = connect_db()
    try:
        rows = conn.execute(
            """SELECT c.address_line1, c.address_line2, c.city, c.state, c.postal_code
               FROM church c
               WHERE c.address_line1 IS NOT NULL AND c.address_line1 != ''"""
        ).fetchall()
    finally:
        conn.close()

    pending = [
        r for r in rows
        if address_key(r["address_line1"], r["address_line2"], r["city"], r["state"], r["postal_code"])
        not in already_geocoded
    ]
    if limit is not None:
        pending = pending[:limit]

    updated = 0
    failed = 0
    for r in pending:
        addr_str = format_address(
            r["address_line1"], r["address_line2"], r["city"], r["state"], r["postal_code"],
        )
        try:
            coords = geocode_address(addr_str, email=email)
        except (OSError, ValueError, KeyError) as exc:
            LOGGER.warning("Geocode failed for %s: %s", addr_str, exc)
            failed += 1
            if pause_seconds > 0:
                time.sleep(pause_seconds)
            continue
        if coords is None:
            failed += 1
            if pause_seconds > 0:
                time.sleep(pause_seconds)
            continue

        if not dry_run:
            geocode_results.append({
                "line1": r["address_line1"],
                "line2": r["address_line2"],
                "city": r["city"],
                "state": r["state"],
                "postal_code": r["postal_code"],
                "latitude": coords[0],
                "longitude": coords[1],
            })
            save_json_list(GEOCODE_RESULTS_PATH, geocode_results)
        updated += 1
        if pause_seconds > 0:
            time.sleep(pause_seconds)

    return {"checked": len(pending), "updated": updated, "failed": failed}
