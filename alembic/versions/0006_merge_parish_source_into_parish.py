"""Merge parish_source into parish table."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0006_merge_parish_source"
down_revision = "0005_seed_websites"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE parish ADD COLUMN source_type TEXT")
    op.execute("ALTER TABLE parish ADD COLUMN source_provider_id TEXT")
    op.execute(
        """
        UPDATE parish
        SET source_type = (
                SELECT type FROM parish_source
                WHERE parish_id = parish.id
                LIMIT 1
            ),
            source_provider_id = (
                SELECT provider_id FROM parish_source
                WHERE parish_id = parish.id
                LIMIT 1
            )
        """
    )
    op.execute("DROP TABLE parish_source")


def downgrade() -> None:
    # Recreate parish_source with original schema
    op.execute(
        """
        CREATE TABLE parish_source (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parish_id INTEGER NOT NULL REFERENCES parish(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            provider_id TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(parish_id, type, provider_id)
        )
        """
    )
    # Repopulate from parish columns
    op.execute(
        """
        INSERT INTO parish_source (parish_id, type, provider_id, created_at)
        SELECT id, source_type, source_provider_id, created_at
        FROM parish
        WHERE source_type IS NOT NULL
        """
    )
    # SQLite table-rebuild to remove columns (safe across all SQLite versions)
    op.execute(
        """
        CREATE TABLE parish_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute("INSERT INTO parish_new (id, name, created_at) SELECT id, name, created_at FROM parish")
    op.execute("DROP TABLE parish")
    op.execute("ALTER TABLE parish_new RENAME TO parish")
