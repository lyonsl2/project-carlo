"""Seed parish table from website rows with known bulletin providers."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

LOGGER = logging.getLogger(__name__)


def seed_parishes(*, db_path: Path, dry_run: bool) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT parish_name, homepage_url, bulletin_provider, provider_id
            FROM website
            WHERE bulletin_provider IN ('ecatholic', 'parishes_online')
              AND parish_name IS NOT NULL
            ORDER BY id
            """
        ).fetchall()

        inserted = 0
        skipped = 0
        for row in rows:
            parish_name = row["parish_name"]
            provider = row["bulletin_provider"]

            if provider == "ecatholic":
                source_type = "ecatholic"
                source_provider_id = row["homepage_url"]
            else:
                source_type = "parishes-online"
                source_provider_id = row["provider_id"]

            if not source_provider_id:
                LOGGER.warning("Skipping %s: no provider id", parish_name)
                skipped += 1
                continue

            if dry_run:
                LOGGER.info(
                    "[DRY RUN] Would insert: name=%s source_type=%s source_provider_id=%s",
                    parish_name,
                    source_type,
                    source_provider_id,
                )
                inserted += 1
                continue

            now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            try:
                conn.execute(
                    """
                    INSERT INTO parish (name, source_type, source_provider_id, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (parish_name, source_type, source_provider_id, now),
                )
                inserted += 1
                LOGGER.info("Inserted: name=%s source_type=%s", parish_name, source_type)
            except sqlite3.IntegrityError:
                LOGGER.info("Already exists: name=%s", parish_name)
                skipped += 1

        if not dry_run:
            conn.commit()
        return {"inserted": inserted, "skipped": skipped}
    finally:
        conn.close()
