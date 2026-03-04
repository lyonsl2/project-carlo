"""Add markdown text storage to bulletin."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_add_bulletin_markdown_text"
down_revision = "0002_seed_initial_parishes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE bulletin ADD COLUMN markdown_text TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE bulletin DROP COLUMN markdown_text")
