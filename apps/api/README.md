# API app

Run locally from repository root:

```bash
uv run uvicorn apps.api.main:app --reload
```

The API reads from `data/parish_events.db` by default.
