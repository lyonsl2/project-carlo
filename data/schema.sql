-- Project Carlo database schema
-- Recreated from scratch by: python -m pdf_extract db create

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS website (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    homepage_url TEXT NOT NULL UNIQUE,
    bulletin_provider TEXT,
    provider_id TEXT,
    bulletin_page TEXT
);

CREATE TABLE IF NOT EXISTS parish (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    source_type TEXT,
    source_provider_id TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS church (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id INTEGER NOT NULL REFERENCES parish(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    latitude REAL,
    longitude REAL,
    name_verified INTEGER NOT NULL DEFAULT 0,
    address_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_church_slug ON church(slug);
CREATE INDEX IF NOT EXISTS idx_church_parish_name ON church(parish_id, name);
CREATE INDEX IF NOT EXISTS idx_church_lat_lng ON church(latitude, longitude);

CREATE TABLE IF NOT EXISTS bulletin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id INTEGER NOT NULL REFERENCES parish(id) ON DELETE CASCADE,
    source_url TEXT,
    pdf_path TEXT,
    published_date TEXT,
    fetched_at TEXT,
    processed_at TEXT,
    content_hash TEXT,
    UNIQUE(parish_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_bulletin_parish_processed ON bulletin(parish_id, processed_at);

CREATE TABLE IF NOT EXISTS event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER NOT NULL REFERENCES church(id) ON DELETE RESTRICT,
    bulletin_id INTEGER REFERENCES bulletin(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    day_of_week TEXT,
    date TEXT,
    start_time INTEGER NOT NULL,  -- minutes since midnight (0-1439)
    end_time INTEGER,             -- minutes since midnight, NULL if not applicable
    cancelled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_bulletin ON event(bulletin_id);
