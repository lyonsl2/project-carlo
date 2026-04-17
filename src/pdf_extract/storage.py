"""SQLite storage helpers and shared data paths."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

# ── Data paths ──────────────────────────────────────────────────────────────
DATA_DIR = Path("data")
DEFAULT_DB_PATH = DATA_DIR / "parish_events.db"
SCHEMA_PATH = DATA_DIR / "schema.sql"
PARISHES_CSV_PATH = DATA_DIR / "parishes.csv"
DETECT_RESULTS_PATH = DATA_DIR / "detect_results.json"
BULLETINS_DIR = DATA_DIR / "bulletins"
BULLETINS_METADATA_PATH = DATA_DIR / "metadata.json"
CHURCHES_CSV_PATH = DATA_DIR / "churches.csv"
VERIFY_RESULTS_PATH = DATA_DIR / "verify_results.json"
GEOCODE_RESULTS_PATH = DATA_DIR / "geocode_results.json"
EVENTS_PATH = DATA_DIR / "events.json"

# Wait on SQLITE_BUSY before failing (multiple processes / concurrent sessions).
SQLITE_BUSY_TIMEOUT_MS = 10_000


# ── Connection helpers ──────────────────────────────────────────────────────
def configure_sqlite_connection(conn: sqlite3.Connection) -> None:
    """Shared PRAGMAs for pipeline DB access: WAL concurrency, lock backoff, FK checks."""
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")


def connect_db(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    configure_sqlite_connection(conn)
    return conn


def delete_db(db_path: Path = DEFAULT_DB_PATH) -> bool:
    if not db_path.exists():
        return False
    db_path.unlink()
    return True


# ── Timestamp helper ────────────────────────────────────────────────────────
def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ── JSON file helpers ───────────────────────────────────────────────────────
def load_json_list(path: Path) -> list[Any]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def save_json_list(path: Path, data: list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json_dict(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_json_dict(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ── DB read helpers (used by pipeline steps) ────────────────────────────────
def list_parishes(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT id, slug, name, homepage_url, bulletin_provider, provider_id FROM parish ORDER BY id"
    ).fetchall()


def get_parish_by_name(conn: sqlite3.Connection, name: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, slug, name, homepage_url, bulletin_provider, provider_id"
        " FROM parish WHERE name = ?",
        (name,),
    ).fetchone()


def list_existing_bulletin_urls(conn: sqlite3.Connection, parish_id: int) -> set[str]:
    rows = conn.execute("SELECT source_url FROM bulletin WHERE parish_id = ?", (parish_id,)).fetchall()
    return {str(r["source_url"]) for r in rows}


def list_churches(conn: sqlite3.Connection, parish_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT id, parish_id, slug, name, address_line1, address_line2, city, state, postal_code"
        " FROM church WHERE parish_id = ? ORDER BY id",
        (parish_id,),
    ).fetchall()
