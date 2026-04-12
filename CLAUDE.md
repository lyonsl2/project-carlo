# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Carlo is a Catholic parish bulletin data pipeline and web viewer. It scrapes parish websites for PDF bulletins, extracts Mass/Confession/Adoration schedules using Gemini AI, stores results in SQLite, and serves them via a React map-based frontend on Cloudflare Workers.

## Commands

### Setup

```bash
uv sync --group dev    # Python dependencies
pnpm install           # Node dependencies (includes web app)
```

### Pipeline (via pnpm scripts)

```bash
pnpm detect            # Detect bulletin providers (Playwright)
pnpm detect:apply      # Write detect results into parishes.csv
pnpm run fetch         # Download bulletins from provider URLs
pnpm process           # Extract schedules via Gemini
pnpm verify            # Verify church data via Gemini
pnpm verify:apply      # Write verify results into churches.csv
pnpm geocode           # Backfill church coordinates (Nominatim)
pnpm geocode:apply     # Write geocode results into churches.csv
pnpm db:create         # Recreate DB from schema + data files
pnpm db:drop           # Delete database
```

### Testing & Linting

```bash
pnpm test                       # Run all Python tests
pnpm test -- tests/test_foo.py  # Run single test file
pnpm test -- -k test_name      # Run single test by name
pnpm lint                       # Python linting (ruff)
pnpm check:web                  # TypeScript type checking
pnpm lint:web                   # ESLint
```

### Web App

```bash
pnpm dev:web       # Dev server on localhost:5173
pnpm build:web     # Production build
pnpm extract:web   # Build frontend.db snapshot from main DB
```

## Architecture

### Data Pipeline (Python: `src/pdf_extract/`)

```
parishes.csv → [detect.py] Playwright → detect_results.json
                                            ↓
               [apply.py] detect apply → parishes.csv (+ bulletin_provider, provider_id)
                                            ↓
                              [db.py] create DB from schema.sql + CSV data files
                                            ↓
                       [fetch.py] fetch_bulletins() → download PDFs → metadata.json
                                            ↓
                       [process.py] process_bulletins() → [schedule_extraction.py] Gemini AI
                                            ↓
                                        events.json
                                            ↓
                       [verify.py] verify_churches() → verify_results.json
                                            ↓
               [apply.py] verify apply → churches.csv (+ name_verified, address_verified)
                       [geocode.py] run_backfill() → geocode_results.json
                                            ↓
               [apply.py] geocode apply → churches.csv (+ latitude, longitude)
                                            ↓
                       [db.py] create_db() → parish_events.db
                                            ↓
                       [extract_frontend_db.py] → frontend.db (minimal subset)
```

Key modules:

- **fetch.py** — Bulletin fetching: provider link resolution (eCatholic, ParishesOnline via Playwright), PDF download, browser management
- **process.py** — Bulletin processing: Gemini AI extraction, maps events to known churches from DB
- **verify.py** — Church verification: validates church names/addresses against bulletin PDFs via Gemini
- **schedule_extraction.py** — Pydantic models + Gemini prompts for extraction and verification
- **storage.py** — Data paths, SQLite helpers, JSON file I/O
- **apply.py** — Merge detect/verify/geocode JSON results back into source CSVs (parishes.csv, churches.csv)
- **db.py** — Database creation: loads schema.sql then populates from CSV data files
- **detect.py** — Playwright-based provider detection (ecatholic, parishes_online, discover_mass)
- **geocode.py** — Nominatim geocoding, writes results to geocode_results.json

### Database

- Schema source of truth: `data/schema.sql`
- Main DB: `data/parish_events.db`
- Frontend DB: `apps/web/public/frontend.db` (subset for browser WASM SQLite)
- Tables: website, parish, church, bulletin, event

### Web Frontend (`apps/web/`)

- React 19 + TypeScript + Vite
- sql.js for in-browser SQLite (loads frontend.db via WASM)
- Leaflet/react-leaflet for map rendering
- TanStack Query for data fetching
- Deploys to Cloudflare Workers

## Environment Variables

- `GEMINI_API_KEY` — Required for `process` subcommand (Gemini AI extraction)

## Tech Stack

- **Python >=3.13**, managed with **uv**, build system **Hatchling**
- **pnpm** workspace for Node.js
- **Ruff** for Python linting (line-length=100, target py313)
- **pytest** for Python tests
