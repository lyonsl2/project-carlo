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

## Weekly Docker workflow

Use the included Docker setup to run the weekly pipeline in one repeatable environment:

`fetch -> process -> extract:web -> verify:frontend-snapshot -> build:web`

The pipeline updates `data/metadata.json`, `data/events.json`, and `apps/web/public/frontend.snapshot`.
Downloaded PDFs and local SQLite/build artifacts stay untracked.

### First-time setup

1. Make sure you have `GEMINI_API_KEY` available in your shell.
2. Build the image:

```bash
docker compose build weekly-job
```

### Local weekly run

```bash
export GEMINI_API_KEY=...
docker compose run --rm -e GEMINI_API_KEY weekly-job
```

This runs `pnpm weekly:run`. It does not create commits; GitHub Actions owns the
scheduled commit step. Compose does not pass your repo `.env` file into the
container; pass only the specific variables you want with `-e`.

The Docker image runs Playwright in headed mode under `xvfb` when no display is
available. This avoids true headless mode while still working on GitHub-hosted
runners. For debugging, set `PLAYWRIGHT_HEADLESS=1` to force headless mode or
`PLAYWRIGHT_BROWSER_CHANNEL=chrome` to use a locally installed Chrome channel.

### GitHub Actions weekly run

The scheduled workflow lives at `.github/workflows/weekly-docker.yml`.

Required repository secrets:

- `GEMINI_API_KEY`

The workflow:

- runs on `workflow_dispatch` and Sundays at `08:17` UTC;
- builds the Docker image with Buildx and GitHub Actions layer cache;
- runs the weekly pipeline inside the container;
- copies back only `data/metadata.json`, `data/events.json`, and `apps/web/public/frontend.snapshot`;
- commits and pushes generated changes with the GitHub Actions bot when there is a diff.

GitHub scheduled workflows run on the default branch and use UTC. The `17` minute offset avoids the highest-load top-of-hour window.

### Scheduler examples

Linux cron (every Sunday at 03:00):

```cron
0 3 * * 0 cd /path/to/project-carlo && docker compose run --rm -e GEMINI_API_KEY weekly-job
```

Windows Task Scheduler action:

- Program/script: `docker`
- Arguments: `compose run --rm -e GEMINI_API_KEY weekly-job`
- Start in: path to the repository root

### Troubleshooting

- **Missing API keys**: pass `GEMINI_API_KEY` with `docker compose run -e`, or set it as a repository secret for GitHub Actions.
- **No commit created in GitHub Actions**: expected when the generated outputs did not change.
- **Verification failed**: `verify:frontend-snapshot` exits non-zero and stops build/commit by design.
- **Dependency changes not reflected locally**: rebuild the image with `docker compose build weekly-job`.
- **Browser behavior differs**: Docker defaults to headed Chromium under `xvfb`; set `PLAYWRIGHT_HEADLESS=1` only when you specifically want true headless mode.

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

## Accounts and payments

The web app can run as a subscription product: sign-in by magic link, a 7-day
free trial that does not ask for a card, and Stripe for payment. It is off by
default — with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` unset the site
builds and behaves exactly as it does today, and the Supabase client is never
loaded at runtime.

Setup is entirely manual (Supabase project, Stripe product, webhook, secrets)
and written up in [`docs/auth-and-payments-setup.md`](docs/auth-and-payments-setup.md),
along with the decisions worth revisiting and the gaps left open on purpose.

Server-side pieces live in `supabase/`:

```bash
supabase db push                          # apply migrations
supabase functions deploy                 # stripe-checkout, stripe-portal, stripe-webhook
supabase test db                          # pgTAP suite for the RLS policies
./scripts/db-test-local.sh                # the same suite, without Docker
cd supabase/functions && deno test --allow-env
```

## Environment Variables

- `GEMINI_API_KEY`: automatically picked up by the Gemini client.

### Web app (`apps/web`)

- `VITE_GEOAPIFY_API_KEY`: place search on the map (see `apps/web/.env.production`).
- `VITE_TALLY_FORM_ID`: Tally form ID for user feedback (e.g. `Me65rA` from `https://tally.so/r/Me65rA`). Set in `apps/web/.env.development` (dev) and `apps/web/.env.production` (build). When unset, feedback links are hidden.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: switch accounts and billing on. See `apps/web/.env.example`.
- `VITE_REQUIRE_ACCOUNT`: set to `false` to keep the map public while still offering accounts. Defaults to on once Supabase is configured.
- `VITE_AUTH_GOOGLE_ENABLED`: adds a "Continue with Google" button.

## User feedback

Comments and corrections are collected with [Tally](https://tally.so). The form should include hidden fields named `page_path`, `full_url`, `church_slug`, and `church_name` (the app prefills these when someone opens the popup).

Review submissions in the Tally dashboard for your form → **Submissions**. Export CSV when batching data fixes.

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
