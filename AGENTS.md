# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Project Carlo is a Catholic parish bulletin data pipeline (Python) and web viewer (React/Vite). See `CLAUDE.md` for commands, architecture details, and the full project layout.

### Services

| Service | How to run | Notes |
|---|---|---|
| Python pipeline | `pnpm <stage>` (e.g. `pnpm run fetch`, `pnpm process`) | Requires `GEMINI_API_KEY` in `.env` for AI stages |
| Web frontend | `pnpm dev:web` | Vite dev server on `localhost:5173` |

### Key commands

All standard commands (`pnpm test`, `pnpm lint`, `pnpm check:web`, `pnpm lint:web`, `pnpm dev:web`, `pnpm build:web`) are documented in `CLAUDE.md`.

### Non-obvious notes

- **pnpm build scripts**: After `pnpm install`, you must run `pnpm rebuild esbuild workerd sharp msw` to execute ignored build scripts (pnpm 10 requires explicit approval). Without this, Vite and Wrangler will fail.
- **Frontend snapshot**: Before running `pnpm dev:web`, you need a `frontend.snapshot` file. Run `pnpm extract:web` to generate it from the SQLite database. The snapshot file is committed at `apps/web/public/frontend.snapshot`, so this is only needed if you've changed data.
- **Python >=3.13 required**: The project targets Python 3.13. Use `uv python install 3.13` if the system Python is older.
- **Database rebuild**: The SQLite database (`data/parish_events.db`) is rebuilt from flat files (CSV, JSON, schema.sql) via `pnpm db:create`. Pipeline commands auto-rebuild the DB before running.
- **No Docker, no external services**: Everything is file-based (SQLite, CSV, JSON). External APIs (Gemini, Nominatim, Geoapify) are optional or mocked in tests.
- **Playwright browsers**: Needed only for `detect` and `fetch` pipeline stages. Install with `uv run playwright install --with-deps chromium`. Tests mock Playwright calls.
