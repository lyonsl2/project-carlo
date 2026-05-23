"""Verify that frontend snapshots stay similar enough between updates."""

from __future__ import annotations

import gzip
import logging
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
CURRENT_SNAPSHOT_PATH = ROOT / "apps" / "web" / "public" / "frontend.snapshot"
PREVIOUS_SNAPSHOT_PATH = ROOT / "apps" / "web" / "public" / "frontend.snapshot.previous"

EVENT_DELTA_THRESHOLD_PCT = 10.0
WEEKLY_MATCH_THRESHOLD_PCT = 90.0

WeeklyKey = tuple[int, str, str, int]


def _load_gzip_sqlite(path: Path) -> tuple[sqlite3.Connection, Path]:
    if not path.exists():
        raise FileNotFoundError(f"Snapshot not found: {path}")

    with gzip.open(path, "rb") as compressed:
        db_bytes = compressed.read()

    temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.write(db_bytes)
    temp_file.close()

    conn = sqlite3.connect(temp_path)
    return conn, temp_path


def _count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def _weekly_keys(conn: sqlite3.Connection) -> set[WeeklyKey]:
    rows = conn.execute(
        """
        SELECT church_id, event_type, COALESCE(day_of_week, ''), start_time
        FROM event
        WHERE LOWER(event_kind) = 'weekly'
        """
    ).fetchall()
    return {(int(r[0]), str(r[1]), str(r[2]), int(r[3])) for r in rows}


def verify_frontend_snapshot(
    current: Path = CURRENT_SNAPSHOT_PATH,
    previous: Path = PREVIOUS_SNAPSHOT_PATH,
) -> dict[str, Any]:
    errors: list[str] = []
    current_conn: sqlite3.Connection | None = None
    previous_conn: sqlite3.Connection | None = None
    current_tmp: Path | None = None
    previous_tmp: Path | None = None

    try:
        try:
            current_conn, current_tmp = _load_gzip_sqlite(current)
            previous_conn, previous_tmp = _load_gzip_sqlite(previous)
        except FileNotFoundError as exc:
            errors.append(str(exc))
            return {
                "passed": False,
                "errors": errors,
                "current_snapshot_path": str(current),
                "previous_snapshot_path": str(previous),
            }

        current_church_count = _count(current_conn, "church")
        previous_church_count = _count(previous_conn, "church")
        churches_equal = current_church_count == previous_church_count

        current_event_count = _count(current_conn, "event")
        previous_event_count = _count(previous_conn, "event")
        if previous_event_count > 0:
            event_delta_pct = abs(current_event_count - previous_event_count) / previous_event_count * 100.0
        else:
            event_delta_pct = 0.0 if current_event_count == 0 else 100.0
        events_within_threshold = event_delta_pct <= EVENT_DELTA_THRESHOLD_PCT

        current_weekly_keys = _weekly_keys(current_conn)
        previous_weekly_keys = _weekly_keys(previous_conn)
        weekly_matches = len(current_weekly_keys & previous_weekly_keys)
        if previous_weekly_keys:
            weekly_match_pct = weekly_matches / len(previous_weekly_keys) * 100.0
        else:
            weekly_match_pct = 100.0 if not current_weekly_keys else 0.0
        weekly_match_pass = weekly_match_pct >= WEEKLY_MATCH_THRESHOLD_PCT

        passed = churches_equal and events_within_threshold and weekly_match_pass
        result = {
            "passed": passed,
            "thresholds": {
                "church_count_must_match_exactly": True,
                "event_delta_max_pct": EVENT_DELTA_THRESHOLD_PCT,
                "weekly_match_min_pct": WEEKLY_MATCH_THRESHOLD_PCT,
            },
            "current_snapshot_path": str(current),
            "previous_snapshot_path": str(previous),
            "churches": {
                "current": current_church_count,
                "previous": previous_church_count,
                "passed": churches_equal,
            },
            "events": {
                "current": current_event_count,
                "previous": previous_event_count,
                "delta_pct": round(event_delta_pct, 2),
                "passed": events_within_threshold,
            },
            "weekly_events": {
                "current_count": len(current_weekly_keys),
                "previous_count": len(previous_weekly_keys),
                "matching_count": weekly_matches,
                "match_pct": round(weekly_match_pct, 2),
                "passed": weekly_match_pass,
            },
            "errors": errors,
        }

        LOGGER.info(
            "frontend snapshot verification: passed=%s | events delta=%.2f%% | weekly match=%.2f%%",
            passed,
            event_delta_pct,
            weekly_match_pct,
        )
        return result
    finally:
        if current_conn is not None:
            current_conn.close()
        if previous_conn is not None:
            previous_conn.close()
        if current_tmp is not None:
            current_tmp.unlink(missing_ok=True)
        if previous_tmp is not None:
            previous_tmp.unlink(missing_ok=True)
