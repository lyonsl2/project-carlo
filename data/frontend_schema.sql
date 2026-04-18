-- Minimal SQLite schema for the web frontend snapshot (apps/web/public/frontend.db).
-- Built by: python -m pdf_extract.extract_frontend_db
--
-- This is a denormalised subset of data/schema.sql designed for the browser:
--   * church gains homepage_url (from parish) and bulletin_url (latest bulletin source)
--   * event is trimmed to the columns the SPA actually reads, and scoped to the
--     latest bulletin per parish
--   * foreign keys are omitted because the snapshot is never mutated

CREATE TABLE church (
    id INTEGER PRIMARY KEY,
    parish_id INTEGER NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    latitude REAL,
    longitude REAL,
    homepage_url TEXT,
    bulletin_url TEXT
);

CREATE INDEX idx_church_slug ON church(slug);

CREATE TABLE event (
    id INTEGER PRIMARY KEY,
    church_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    day_of_week TEXT,
    date TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    cancelled INTEGER NOT NULL,
    page_number INTEGER
);

CREATE INDEX idx_event_church ON event(church_id);
CREATE INDEX idx_event_type ON event(event_type);
