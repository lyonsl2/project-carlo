# Diocese of Buffalo expansion — working scratchbook

Goal: expand the churches supported by Project Carlo to include parishes/churches
of the **Roman Catholic Diocese of Buffalo** (Western New York). The current
dataset covers the Diocese of Rochester only.

This file is the running log of reasoning, sources, edge cases, and decisions.
The final curated data lives in `data/parishes.csv` and `data/churches.csv`.

## How the data model works (verified by reading the code)

- `data/parishes.csv` columns: `slug,name,website,bulletin_provider,provider_id`
  - One row per parish "organization". `website` (→ `parish.homepage_url`) must be
    **non-null and UNIQUE**. `slug` must be **UNIQUE**.
  - `bulletin_provider` ∈ {`ecatholic`, `parishes_online`, `discover_mass`,
    `google_drive`, `no_bulletin`, `other`, or empty}. Empty means the `detect`
    stage will fill it later (`src/pdf_extract/detect.py`).
  - `provider_id` is the provider-specific identifier (only used by some providers).
- `data/churches.csv` columns:
  `parish_id,slug,name,line1,line2,city,state,postal_code,name_verified,address_verified,latitude,longitude`
  - `parish_id` is the **parish slug** (FK by slug, resolved in `db.py`).
  - One row per physical worship site. A parish may have several churches.
  - `slug` must be **UNIQUE** across all churches.
  - `latitude`/`longitude` are backfilled by the `geocode` stage from the address
    (Nominatim) — see `src/pdf_extract/geocode.py` + `apply_geocode_results`.
  - `name_verified`/`address_verified` are `true`/`false`/empty booleans set by the
    human/AI verify stage (`apply_verify_results`).

## Environment constraints (important edge cases)

1. **Direct HTTP is blocked by the environment network policy.** `curl` and the
   `WebFetch` tool both return HTTP 403 for every host tried (incl. example.com,
   wikipedia.org, buffalodiocese.org, nominatim.openstreetmap.org). The **only**
   working research channel is the `WebSearch` tool, which returns result
   titles/URLs plus a synthesized summary of snippets.
   - Consequence: I curate parish name/address/website from WebSearch snippets and
     cross-check across multiple queries. I cannot scrape the diocese parish-finder
     directly.
2. **Geocoding is not possible in this environment** (Nominatim is also blocked).
   So new church rows are added with **blank `latitude`/`longitude`**. The weekly
   pipeline's `geocode` stage will backfill them from the address on a normal run
   (it already skips rows that are missing coordinates and fills them). This is the
   intended division of labor — the CSV carries the human-curated address; geocode
   owns coordinates. I note each batch as "needs geocode".
3. **Provider detection is not possible here** (needs Playwright + live site). New
   parish rows get `bulletin_provider` left **empty** so the `detect` stage claims
   them on the next run. Where a search result clearly shows the provider (e.g. the
   site is on parishesonline.com / ecatholic), I record it directly.

## Decisions / conventions

- Slug convention: lowercase, hyphenated, disambiguated by city when a dedication
  is common (e.g. `st-john-the-baptist-kenmore`). Mirrors existing Rochester slugs.
- `state` is always `NY`. The Diocese of Buffalo covers 8 WNY counties: Erie,
  Niagara, Cattaraugus, Chautauqua, Allegany, Genesee, Orleans, Wyoming.
- I set `name_verified`/`address_verified` to `true` only when the address is
  corroborated by the parish's own site/listing in search results; otherwise blank
  (lets the verify stage review it). Coordinates always blank (see constraint #2).
- Incremental: each batch is a separate commit so progress is saved.

## Research log

(Newest first. Each entry: parish, what I found, source confidence, edge cases.)
