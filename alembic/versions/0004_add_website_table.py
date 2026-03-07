"""Add website table for bulletin provider detection."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0004_add_website_table"
down_revision = "0003_add_church_coordinates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE website (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            homepage_url TEXT NOT NULL UNIQUE,
            parish_name TEXT,
            parish_slug TEXT,
            processed_at TEXT,
            bulletin_provider TEXT,
            provider_id TEXT,
            bulletin_page TEXT
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS website")
