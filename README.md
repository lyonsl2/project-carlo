# Bulletin Processing Pipeline

Fetch parish bulletin PDFs and process schedule events (Mass, Confession, Adoration)
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

Run the full pipeline (`fetch -> process`):

```bash
uv run python -m pdf_extract
```

Optional flags:

- `--parish "Southeast Rochester Catholic Community"` (if omitted, runs all parishes in DB)
- `--model gemini-3-flash-preview` (used by `process` and full pipeline)
- `--log-level DEBUG|INFO|WARNING|ERROR` (default: `INFO`)
- `--migrate` (run `alembic upgrade head` and exit)
- `--delete-db` (delete the DB file and exit)
- `--downgrade` or `--downgrade <revision>` (default is one step back, `-1`)

Run each stage independently:

```bash
uv run python -m pdf_extract fetch [--parish "..."]
uv run python -m pdf_extract process [--parish "..."] [--model gemini-3-flash-preview]
```

Stage idempotency:

- `fetch` skips URLs already recorded in `bulletin.source_url`
- `process` skips rows with `processed_at` already set

### From Python

```python
from pdf_extract import fetch_bulletins, process_bulletins, sync_bulletins

fetch_result = fetch_bulletins(parish_name="Southeast Rochester Catholic Community")
process_result = process_bulletins(parish_name="Southeast Rochester Catholic Community")
full_result = sync_bulletins(parish_name="Southeast Rochester Catholic Community")
```

## Environment Variables

- `GEMINI_API_KEY`: automatically picked up by the Gemini client.
- `GOOGLE_API_KEY`: also supported by the SDK as an alternative environment variable.

## Database workflow

Database changes are migration-first, with SQL in Alembic revisions:

- `alembic/versions/*.py` is the source of truth for schema history.
- Use SQL in `upgrade()`/`downgrade()` via `op.execute(...)`.
- Run migrations at process startup or deploy time.

Useful commands:

```bash
uv run alembic upgrade head
uv run alembic revision -m "describe change"
```

Backfill church coordinates from address data (OpenStreetMap Nominatim):

```bash
uv run python scripts/geocode_churches.py --dry-run
uv run python scripts/geocode_churches.py --email "you@example.com"
```

## Project layout

- `pyproject.toml` - project metadata and dependencies
- `package.json` and `pnpm-workspace.yaml` - JS workspace for frontend
- `uv.lock` - locked dependency versions
- `apps/web` - React + TypeScript + Vite frontend
- `apps/web/scripts/extract_frontend_db.py` - builds the frontend SQLite snapshot
- `scripts/geocode_churches.py` - optional coordinate backfill helper
- `src/pdf_extract/schedule_extraction.py` - Gemini schedule extraction implementation
- `src/pdf_extract/sync.py` - fetch/process orchestration
- `src/pdf_extract/storage.py` - SQLite helpers and migration runner
- `src/pdf_extract/__main__.py` - CLI entry point
- `alembic/` - migration environment and revisions

## Dependencies

- [google-genai](https://github.com/googleapis/python-genai) - Gemini API client for PDF processing and structured JSON output.
- [playwright](https://playwright.dev/python/) - provider site link resolution where needed.
- [alembic](https://alembic.sqlalchemy.org/) and [sqlalchemy](https://www.sqlalchemy.org/) - migration workflow.

To add more dependencies:

```bash
uv add package-name
```

## Development

Run linting:

```bash
uv run ruff check .
```

Run tests:

```bash
uv run pytest
```
