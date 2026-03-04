# PDF text extraction

Extract text from PDF files using Python, PyMuPDF, and Docling. Optionally use the OpenAI Responses API to extract structured schedule data from text.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) for Python and dependency management.

  Install on Windows (PowerShell):

  ```powershell
  powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```

  Restart your terminal, then run `uv --version` to confirm.

## Setup

From the project root:

```bash
uv sync --group dev
```

This creates a `.venv` with the Python version in `.python-version` (3.13), installs dependencies from `pyproject.toml`, and generates/updates `uv.lock` for reproducible installs.

## Usage

### Command line

Run the full pipeline (fetch -> extract -> parse):

```bash
uv run python -m pdf_extract
```

Optional flags:

- `--parish "Southeast Rochester Catholic Community"` (if omitted, runs all parishes in DB)
- `--model gpt-5-nano` (used by `parse` and full pipeline)
- `--log-level DEBUG|INFO|WARNING|ERROR` (default: `INFO`)
- `--migrate` (run `alembic upgrade head` and exit)
- `--delete-db` (delete the DB file and exit)
- `--downgrade` or `--downgrade <revision>` (default is one step back, `-1`)

Run each stage independently:

```bash
uv run python -m pdf_extract fetch [--parish "..."]
uv run python -m pdf_extract extract [--parish "..."]
uv run python -m pdf_extract parse [--parish "..."] [--model gpt-5-nano]
```

Stage idempotency:

- `fetch` skips URLs already recorded in `bulletin.source_url`
- `extract` skips rows with `text_extracted_at` already set (writes both `text_pages_json` and `markdown_text`)
- `parse` skips rows with `parse_completed_at` already set

Provider behavior (during `fetch`):

- `ecatholic`: fetches `{provider_id}/bulletins` HTML, finds the first anchor whose `href` contains both `files.ecatholic.com` and `bulletins`, then downloads that PDF.
- `parishes-online`: opens `https://parishesonline.com/organization/{provider_id}` with Playwright, finds the first publication link, extracts `selectedPublication=<pdf_url>`, then downloads that PDF.

### From Python

```python
from pdf_extract import extract_text, extract_events
from pdf_extract.text_extraction import extract_markdown_with_docling, extract_text_by_page

# All text as one string
text = extract_text("document.pdf")

# One string per page
pages = extract_text_by_page("document.pdf")

# Structured markdown from Docling
markdown = extract_markdown_with_docling("document.pdf")

# Extract Mass/Confession/Adoration schedule via OpenAI (requires OPENAI_API_KEY)
schedule = extract_events(text)
churches_by_id = {c["id"]: c for c in schedule["churches"]}
for event in schedule["events"]:
    church = churches_by_id.get(event["church_id"], {})
    print(church.get("name"), church.get("address"), event["type"], event["kind"])
```

## Database workflow

Database changes are migration-first, with SQL in Alembic revisions (no ORM models required):

- `alembic/versions/*.py` is the source of truth for schema history.
- Use plain SQL in `upgrade()`/`downgrade()` via `op.execute(...)`.
- Keep default data in dedicated Alembic seed/data migrations.
- Run migrations at process startup or deploy time (not on each DB connection).

Useful commands:

```bash
# Apply all migrations to the default DB
uv run alembic upgrade head

# Create a new migration file
uv run alembic revision -m "describe change"
```

## Project layout

- `pyproject.toml` — project metadata, Python version requirement, dependencies
- `uv.lock` — locked dependency versions (commit this)
- `.python-version` — Python version used for this project
- `src/pdf_extract/text_extraction.py` — text extraction implementation
- `src/pdf_extract/schedule_extraction.py` — OpenAI schedule extraction implementation
- `src/pdf_extract/sync.py` — provider-specific bulletin sync pipeline
- `src/pdf_extract/storage.py` — SQLite persistence helpers and migration runner
- `alembic/` — migration environment and migration versions
- `src/pdf_extract/__init__.py` and `src/pdf_extract/__main__.py` — public package API and CLI entry point
- `data/parish_events.db` — SQLite database created on first sync

## Dependencies

- [PyMuPDF](https://pymupdf.readthedocs.io/) (`pymupdf`) — fast page text extraction.
- [Docling](https://docling-project.github.io/docling/) (`docling`) — PDF to markdown conversion used in extract stage.
- [OpenAI](https://github.com/openai/openai-python) (`openai`) — used for schedule extraction via the Responses API during sync runs. Requires an API key: set the `OPENAI_API_KEY` environment variable (or pass `api_key=...` when calling `extract_events()` in code).

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
