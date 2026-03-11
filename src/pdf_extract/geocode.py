"""Backfill church latitude/longitude from address using Nominatim."""

from __future__ import annotations

import json
import logging
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pdf_extract.storage import (
    CHURCHES_PATH,
    load_json_list,
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
    churches = load_json_list(CHURCHES_PATH)

    pending = [
        c for c in churches
        if (c.get("latitude") is None or c.get("longitude") is None)
        and c.get("address")
        and str(c["address"]).strip()
    ]
    if limit is not None:
        pending = pending[:limit]

    updated = 0
    failed = 0
    for c in pending:
        try:
            coords = geocode_address(str(c["address"]), email=email)
        except Exception:
            LOGGER.warning("Geocode failed for %s", c.get("address"), exc_info=True)
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
            c["latitude"] = coords[0]
            c["longitude"] = coords[1]
            save_json_list(CHURCHES_PATH, churches)
        updated += 1
        if pause_seconds > 0:
            time.sleep(pause_seconds)

    return {"checked": len(pending), "updated": updated, "failed": failed}
