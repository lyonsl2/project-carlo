"""Copy ecatholic and parishes-online rows from website into parish table."""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DB_PATH = Path("data/parish_events.db")
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed parish table from website rows with ecatholic or parishes-online providers.",
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    result = seed_parishes(db_path=args.db_path, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
