"""Initial schema."""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE parish (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
        """
    )
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
    op.execute(
        """
        CREATE TABLE church (
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
        CREATE INDEX idx_church_parish_name_normalized
        ON church(parish_id, name_normalized)
        """
    )
    op.execute(
        """
        CREATE TABLE bulletin (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parish_id INTEGER NOT NULL REFERENCES parish(id) ON DELETE CASCADE,
            source_url TEXT NOT NULL,
            pdf_path TEXT,
            published_date TEXT,
            fetched_at TEXT NOT NULL,
            text_pages_json TEXT,
            text_extracted_at TEXT,
            parse_completed_at TEXT,
            content_hash TEXT,
            UNIQUE(parish_id, source_url)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_bulletin_parish_text_extracted
        ON bulletin(parish_id, text_extracted_at)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_bulletin_parish_parse_completed
        ON bulletin(parish_id, parse_completed_at)
        """
    )
    op.execute(
        """
        CREATE TABLE event (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            church_id INTEGER NOT NULL REFERENCES church(id) ON DELETE RESTRICT,
            event_type TEXT NOT NULL,
            event_kind TEXT NOT NULL,
            day_of_week TEXT,
            date TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            cancelled INTEGER NOT NULL,
            raw_json TEXT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE bulletin_event (
            bulletin_id INTEGER NOT NULL REFERENCES bulletin(id) ON DELETE CASCADE,
            event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
            PRIMARY KEY (bulletin_id, event_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS bulletin_event")
    op.execute("DROP TABLE IF EXISTS event")
    op.execute("DROP TABLE IF EXISTS bulletin")
    op.execute("DROP TABLE IF EXISTS church")
    op.execute("DROP TABLE IF EXISTS parish_source")
    op.execute("DROP TABLE IF EXISTS parish")

