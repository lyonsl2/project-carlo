"""SQLite storage for parish bulletin ingestion."""

from __future__ import annotations

import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config

DEFAULT_DB_PATH = Path("data/parish_events.db")
LOGGER = logging.getLogger(__name__)


def connect_db(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Open a SQLite connection (schema must already be migrated)."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    LOGGER.debug("Opened SQLite connection at %s", db_path)
    return conn


def migrate_db(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Apply all Alembic migrations to the target SQLite database."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    LOGGER.info("Running database migrations (path=%s)", db_path)
    alembic_cfg = _build_alembic_config(db_path)
    command.upgrade(alembic_cfg, "head")
    LOGGER.info("Database migrations complete (path=%s)", db_path)


def downgrade_db(db_path: Path = DEFAULT_DB_PATH, revision: str = "-1") -> None:
    """Downgrade the target SQLite database to a given Alembic revision."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    LOGGER.info("Running database downgrade to %s (path=%s)", revision, db_path)
    alembic_cfg = _build_alembic_config(db_path)
    command.downgrade(alembic_cfg, revision)
    LOGGER.info("Database downgrade complete (revision=%s, path=%s)", revision, db_path)


def delete_db(db_path: Path = DEFAULT_DB_PATH) -> bool:
    """Delete the SQLite database file if present. Returns True if deleted."""
    if not db_path.exists():
        LOGGER.info("Delete DB requested but file did not exist (path=%s)", db_path)
        return False
    db_path.unlink()
    LOGGER.info("Deleted database file (path=%s)", db_path)
    return True


def _build_alembic_config(db_path: Path) -> Config:
    """Build Alembic config for the given SQLite file path."""
    project_root = Path(__file__).resolve().parents[2]
    alembic_cfg = Config(str(project_root / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(project_root / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.resolve().as_posix()}")
    return alembic_cfg


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def list_parish_ids(conn: sqlite3.Connection) -> list[int]:
    rows = conn.execute("SELECT id FROM parish ORDER BY id").fetchall()
    return [int(r["id"]) for r in rows]


def get_parish_id(conn: sqlite3.Connection, parish_name: str) -> int:
    row = conn.execute("SELECT id FROM parish WHERE name = ?", (parish_name,)).fetchone()
    if row is None:
        raise ValueError(f"Parish not found: {parish_name}")
    return int(row["id"])


def get_parish_source(conn: sqlite3.Connection, parish_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT source_type, source_provider_id FROM parish WHERE id = ?",
        (parish_id,),
    ).fetchone()


def list_existing_bulletin_urls(conn: sqlite3.Connection, parish_id: int) -> set[str]:
    rows = conn.execute("SELECT source_url FROM bulletin WHERE parish_id = ?", (parish_id,)).fetchall()
    return {str(r["source_url"]) for r in rows}


def insert_bulletin(
    conn: sqlite3.Connection,
    *,
    parish_id: int,
    source_url: str,
    pdf_path: str | None = None,
    published_date: str | None = None,
    content_hash: str | None,
) -> int:
    now = utc_now_iso()
    cur = conn.execute(
        """
        INSERT INTO bulletin(
            parish_id,
            source_url,
            pdf_path,
            published_date,
            fetched_at,
            content_hash
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            parish_id,
            source_url,
            pdf_path,
            published_date,
            now,
            content_hash,
        ),
    )
    return int(cur.lastrowid)


def list_bulletins_pending_processing(
    conn: sqlite3.Connection,
    *,
    parish_id: int | None = None,
) -> list[sqlite3.Row]:
    if parish_id is None:
        return conn.execute(
            """
            SELECT id, parish_id, pdf_path
            FROM bulletin
            WHERE pdf_path IS NOT NULL
              AND processed_at IS NULL
            ORDER BY id
            """
        ).fetchall()
    return conn.execute(
        """
        SELECT id, parish_id, pdf_path
        FROM bulletin
        WHERE parish_id = ?
          AND pdf_path IS NOT NULL
          AND processed_at IS NULL
        ORDER BY id
        """,
        (parish_id,),
    ).fetchall()


def mark_bulletin_processed(conn: sqlite3.Connection, *, bulletin_id: int) -> None:
    conn.execute(
        """
        UPDATE bulletin
        SET processed_at = ?
        WHERE id = ?
        """,
        (utc_now_iso(), bulletin_id),
    )


def list_churches(conn: sqlite3.Connection, parish_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, parish_id, name, address, name_normalized
        FROM church
        WHERE parish_id = ?
        ORDER BY id
        """,
        (parish_id,),
    ).fetchall()


def insert_church(
    conn: sqlite3.Connection,
    *,
    parish_id: int,
    name: str | None,
    address: str | None,
    name_normalized: str | None,
) -> int:
    now = utc_now_iso()
    cur = conn.execute(
        """
        INSERT INTO church(parish_id, name, address, name_normalized, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (parish_id, name, address, name_normalized, now),
    )
    return int(cur.lastrowid)


def update_church_address_if_missing(
    conn: sqlite3.Connection, *, church_id: int, new_address: str | None
) -> None:
    if not new_address:
        return
    conn.execute(
        """
        UPDATE church
        SET address = ?
        WHERE id = ? AND (address IS NULL OR address = '')
        """,
        (new_address, church_id),
    )


def insert_event(
    conn: sqlite3.Connection,
    *,
    church_id: int,
    event_type: str,
    event_kind: str,
    day_of_week: str | None,
    date: str | None,
    start_time: str,
    end_time: str | None,
    cancelled: bool,
    raw_json: str,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO event(
            church_id, event_type, event_kind, day_of_week, date, start_time, end_time, cancelled, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            church_id,
            event_type,
            event_kind,
            day_of_week,
            date,
            start_time,
            end_time,
            int(cancelled),
            raw_json,
        ),
    )
    return int(cur.lastrowid)


def insert_bulletin_event(conn: sqlite3.Connection, *, bulletin_id: int, event_id: int) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO bulletin_event(bulletin_id, event_id) VALUES (?, ?)",
        (bulletin_id, event_id),
    )

