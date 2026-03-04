from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_DB_PATH = Path("data/parish_events.db")
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
    db_path: Path,
    dry_run: bool,
    limit: int | None,
    pause_seconds: float,
    email: str | None,
) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, address
            FROM church
            WHERE address IS NOT NULL
              AND TRIM(address) != ''
              AND (latitude IS NULL OR longitude IS NULL)
            ORDER BY id
            """
        ).fetchall()
        if limit is not None:
            rows = rows[:limit]

        updated = 0
        failed = 0
        for row in rows:
            try:
                church_id = int(row["id"])
                address = str(row["address"])
                try:
                    coordinates = geocode_address(address, email=email)
                except Exception:
                    failed += 1
                    continue
                if coordinates is None:
                    failed += 1
                    continue

                lat, lng = coordinates
                if not dry_run:
                    conn.execute(
                        """
                        UPDATE church
                        SET latitude = ?, longitude = ?
                        WHERE id = ?
                        """,
                        (lat, lng, church_id),
                    )
                updated += 1
            finally:
                if pause_seconds > 0:
                    time.sleep(pause_seconds)

        if not dry_run:
            conn.commit()
        return {"checked": len(rows), "updated": updated, "failed": failed}
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill church latitude/longitude from address.")
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--pause-seconds", type=float, default=1.0)
    parser.add_argument("--email", type=str, default=None)
    args = parser.parse_args()

    result = run_backfill(
        db_path=args.db_path,
        dry_run=args.dry_run,
        limit=args.limit,
        pause_seconds=args.pause_seconds,
        email=args.email,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
