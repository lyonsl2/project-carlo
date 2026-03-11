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
    name TEXT,
    address TEXT,
    name_normalized TEXT,
    latitude REAL,
    longitude REAL,
    created_at TEXT,
    UNIQUE(parish_id, name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_church_parish_name_normalized ON church(parish_id, name_normalized);
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
    start_time TEXT NOT NULL,
    end_time TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_bulletin ON event(bulletin_id);
