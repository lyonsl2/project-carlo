"""Add latitude/longitude columns on church."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_add_church_coordinates"
down_revision = "0002_seed_initial_parishes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE church ADD COLUMN latitude REAL")
    op.execute("ALTER TABLE church ADD COLUMN longitude REAL")
    op.execute("CREATE INDEX idx_church_lat_lng ON church(latitude, longitude)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_church_lat_lng")
    op.execute("PRAGMA foreign_keys=OFF")
    op.execute(
        """
        CREATE TABLE church_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parish_id INTEGER NOT NULL REFERENCES parish(id) ON DELETE CASCADE,
            name TEXT,
            address TEXT,
            name_normalized TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        INSERT INTO church_new(id, parish_id, name, address, name_normalized, created_at)
        SELECT id, parish_id, name, address, name_normalized, created_at
        FROM church
        """
    )
    op.execute("DROP TABLE church")
    op.execute("ALTER TABLE church_new RENAME TO church")
    op.execute(
        """
        CREATE INDEX idx_church_parish_name_normalized
        ON church(parish_id, name_normalized)
        """
    )
    op.execute("PRAGMA foreign_keys=ON")
