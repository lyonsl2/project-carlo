# Bulletin Processing Pipeline

Fetch parish bulletin PDFs and extract schedule events (Mass, Confession, Adoration)
with Gemini into SQLite.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) for Python and dependency management.
- [pnpm](https://pnpm.io/installation) for the web workspace.

Install on Windows (PowerShell):

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Restart your terminal, then run `uv --version` to confirm.

## Setup

From the project root:

```bash
uv sync --group dev
pnpm install
```

`pnpm install` uses [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and installs JavaScript dependencies for `apps/web` (package name `web`) into the workspace store. The root `package.json` has no Node dependencies of its own; `pnpm install:web` is the same command if you prefer an explicit name.

## Run the web app

Refresh the frontend SQLite snapshot:

```bash
pnpm extract:web
```

Start the web app:

```bash
pnpm dev:web
```

## Usage

### Command line

Run each stage independently:

```bash
pnpm run fetch [-- --parish "..."]
pnpm process [-- --parish "..." --model gemini-3-flash-preview]
pnpm detect [-- --dry-run --limit N --pause-seconds 0.5]
pnpm geocode [-- --dry-run --limit N --email "you@example.com"]
pnpm db:create
pnpm db:drop
```

All commands accept `-- --log-level DEBUG|INFO|WARNING|ERROR` (default: `INFO`).

Stage idempotency:

- `fetch` skips URLs already recorded in `bulletin.source_url`
- `process` skips rows with `processed_at` already set

### From Python

```python
from pdf_extract import extract_events, fetch_bulletins, process_bulletins

fetch_result = fetch_bulletins(parish_name="Southeast Rochester Catholic Community")
process_result = process_bulletins(parish_name="Southeast Rochester Catholic Community")
```

## Environment Variables

- `GEMINI_API_KEY`: automatically picked up by the Gemini client.
- `GOOGLE_API_KEY`: also supported by the SDK as an alternative.

## Database workflow

The database is rebuilt from flat files (`data/schema.sql`, CSVs, and JSONs):

```bash
pnpm db:create   # drop and recreate from schema + data files
pnpm db:drop     # delete the SQLite file
```

`schema.sql` is the source of truth for the database schema. Pipeline commands
(`fetch`, `process`) automatically rebuild the DB before running.

## Project layout

- `pyproject.toml` - project metadata and dependencies
- `package.json` and `pnpm-workspace.yaml` - JS workspace for frontend
- `uv.lock` - locked dependency versions
- `data/schema.sql` - SQLite schema (source of truth)
- `data/` - CSV, JSON data files and downloaded bulletin PDFs
- `apps/web/` - React + TypeScript + Vite frontend
- `src/pdf_extract/extract_frontend_db.py` - builds the frontend SQLite snapshot
- `src/pdf_extract/` - Python CLI package
  - `__main__.py` - CLI entry point
  - `fetch.py` - bulletin fetching and provider link resolution
  - `process.py` - bulletin processing with Gemini AI
  - `schedule_extraction.py` - Gemini schedule extraction
  - `storage.py` - SQLite helpers and data paths
  - `db.py` - database creation from data files
  - `detect.py` - bulletin provider detection (Playwright)
  - `geocode.py` - address geocoding (Nominatim)

## Dependencies

- [google-genai](https://github.com/googleapis/python-genai) - Gemini API client for PDF processing and structured JSON output.
- [playwright](https://playwright.dev/python/) - bulletin provider detection and link resolution.
- [pydantic](https://docs.pydantic.dev/) - data validation and Gemini response parsing.

To add more dependencies:

```bash
uv add package-name
```

## Development

Run linting:

```bash
pnpm lint
```

Run tests:

```bash
pnpm test
```
