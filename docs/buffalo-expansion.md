# Diocese of Buffalo expansion — working document

Single source of truth for the Buffalo expansion. Replaces the two earlier files
(`buffalo-expansion-scratchbook.md` from the cloud agent, and
`buffalo-expansion-continuation.md` from the first local session) — both folded in here.

---

## 1. Objective (the rule that governs every row)

Extend Project Carlo (currently Diocese of Rochester only) to the **Roman Catholic
Diocese of Buffalo** (8 WNY counties: Erie, Niagara, Cattaraugus, Chautauqua, Allegany,
Genesee, Orleans, Wyoming).

**One "parish" = one bulletin.** The website attached to that parish is the site where
that bulletin is published/reachable. Concretely:

- A church/community that **publishes its own bulletin on its own website** → its own
  `parish` row.
- A "Family of Parishes" (Buffalo's Road-to-Renewal groupings) that shares **one bulletin
  on one website** → **one** `parish` row with **several** `church` rows (one per worship
  site).
- The Buffalo "Family of Parishes" label is an administrative grouping, **not** necessarily
  a canonical merger and **not** the unit we model. We key on *who publishes the bulletin*.

This matters because the diocese has had heavy recent church closings and parish mergers
into "families," so sources conflict and some structures are still in flux (see §6).

## 2. Data model (verified against the code)

`data/parishes.csv` — `slug,name,website,bulletin_provider,provider_id`
- One row per bulletin-publishing organization. `website` (→ `parish.homepage_url`) must be
  **non-null and globally UNIQUE**; `slug` must be **UNIQUE**. This UNIQUE-website constraint
  is exactly why shared-domain families can't be split into multiple parish rows (§6).
- `bulletin_provider` ∈ {`ecatholic`, `parishes_online`, `discover_mass`, `google_drive`,
  `no_bulletin`, `other`, empty}. **Empty** → the `detect` stage (Playwright, live site)
  fills it on the next pipeline run (`src/pdf_extract/detect.py`). Fill it directly only when
  research clearly exposes the provider (e.g. a real parishesonline org id).
- `provider_id` — provider-specific id (used by some providers, e.g. parishesonline org slug).

`data/churches.csv` —
`parish_id,slug,name,line1,line2,city,state,postal_code,name_verified,address_verified,latitude,longitude`
- `parish_id` = the **parish slug** (FK by slug, resolved in `db.py`).
- One row per physical worship site; a parish may have several. `slug` UNIQUE across all churches.
- `latitude`/`longitude` — backfilled by the `geocode` stage (Nominatim) when blank, but **this
  environment can geocode directly**, so we fill them here (§4).
- `name_verified`/`address_verified` — `true`/`false`/empty booleans set by the verify stage
  (`apply_verify_results`). Set `true` only with ≥2 independent sources or an OSM church node.

Conventions: `state` always `NY`; slugs lowercase-hyphenated, **city-suffixed** when a
dedication already exists in the Rochester data (global UNIQUE) — e.g. `st-louis-buffalo`
because Rochester already has `st-louis` (Pittsford). One commit per batch.

## 3. Current state

**Dataset: 101 parishes / 186 churches; 117 tests green.** (Rochester baseline was 62/132.)

**Buffalo contribution: 39 parishes / 54 churches, all geocoded**, spanning **all 8 counties**.
Only one intentional address flag remains open (Wellsville house number, §6).

`db create` and `pytest` are run after every batch and must stay green (96/176, 117 passed
as of the last commit `eb458d4`).

## 4. Environment (this machine vs. the cloud agent)

The original cloud agent ran in a sandbox where **all direct HTTP was 403** and Nominatim was
blocked, so it left every new church with **blank coordinates** and some addresses unverified,
handing those to the pipeline. **This local machine has working `WebFetch`, `WebSearch`, and
Nominatim** (`uv run python -m pdf_extract geocode run` reaches it; raw `urlopen` to
nominatim.openstreetmap.org works). So here we **geocode and verify inline** — no pipeline
hand-off needed for new rows.

Geocoding method when Nominatim free-form fails: try structured → name+city; if still no hit,
pull the **Plus Code (Open Location Code)** from the church's `gcatholic.org` page, decode it,
and **reverse-geocode to confirm** it lands on the right street/town before committing.

**Known WebFetch 403 hosts** (some parish hosts block the fetcher): `icc-ics.com`,
`emcatholic.org`. Reliable channels that never 403'd: `gcatholic.org` (addresses + Plus Codes),
`cheektowagacatholicfamily.org`, `nfrcfparish.org`, `blessedtrinitybuffalo.org`. **gcatholic.org
is the dependable independent fallback.**

## 5. What's been added (by county / batch)

All 39 Buffalo parishes, newest first. Full per-row reasoning is in git history (commit per
batch, messages `data: add Buffalo batch N`); the load-bearing edge cases are kept in §6.

- **ONE Catholic consolidation** (commit `ac8ecd8`) — collapsed into ONE parish `one-catholic`
  (onecatholic.org; combined bulletin since Dec 2023) with worship sites Holy Family/Albion,
  St. Mary/Medina, St. Mary/Holley. **Removed** the old `holy-family-albion` parish (its website
  holyfamilyalbion.com is now a squatted casino domain) and re-parented its church here. Excluded
  St. Mark/Kendall (closed/for-sale).
- **Niagara Frontier** (commit `693fb43`) — split into `st-peter-lewiston`
  (niagarafrontiercatholic.org; St. Peter + St. Bernard) and `immaculate-conception-ransomville`
  (icransomville.org; single site). St. Raphael omitted — closed Feb 2024, building sold.
- **Niagara Falls family** (commit `0bb742f`) — resolved the largest deferred shared-domain
  family into 3 parishes, each with its own website + bulletin: `st-vincent-de-paul-niagara-falls`
  (svdparish.org; Prince of Peace + St. Leo), `holy-family-niagara-falls` (holyfamilyrcchurch.org;
  St. Mary of the Cataract + St. Joseph), `st-john-de-lasalle-niagara-falls` (stjohndelasalle.org).
- **Batch 8** — `corpus-christi-buffalo` (Corpus Christi, 199 Clark St), `st-stephen-grand-island`
  (St. Stephen, 2100 Baseline Rd — first Grand Island parish).
- **Batch 7** — `blessed-trinity-buffalo`, `st-louis-buffalo` (diocese's oldest parish, 1829),
  `st-bernadette-orchard-park`, `st-rose-of-lima-buffalo`. All single-church, own site, own bulletin.
- **Batch 6** (reaches all 8 counties) — `holy-family-albion` (Orleans), `st-michael-warsaw`
  (Wyoming), `catholic-communities-se-allegany` (Allegany; Wellsville + Belmont).
- **Batch 5** (Southern Tier) — `enchanted-mountains-catholic` (one parish, 4 worship sites:
  Basilica of St. Mary of the Angels / St. John / St. Bonaventure / Sacred Heart-Portville),
  `holy-trinity-dunkirk` (Chautauqua).
- **Batch 4** — `catholic-family-cheektowaga` (one parish, 4 sites), `resurrection-batavia`
  (first Genesee), `christ-the-king-snyder`, `st-pius-x-getzville`, `good-shepherd-pendleton`.
- **Batch 3** — `st-jude-the-apostle-north-tonawanda`, `st-john-baptist-lockport`,
  `our-lady-of-peace-clarence` (+ Our Lady of Czestochowa added as a worship site of existing
  `tonawanda-catholic`).
- **Batch 2** — `st-benedict-amherst`, `ss-peter-and-paul-hamburg`, `immaculate-conception-east-aurora`,
  `st-mary-of-the-lake-hamburg`, `st-mary-swormville`, `st-aloysius-springville`.
- **Batch 1** — `st-joseph-university-buffalo`, `st-john-baptist-kenmore`,
  `st-gregory-the-great-williamsville`, `ss-peter-and-paul-williamsville`, `tonawanda-catholic`
  (St. Amelia / St. Christopher / St. Francis Chapel), `nativity-of-our-lord-orchard-park`,
  `st-mary-assumption-lancaster`, `queen-of-heaven-west-seneca`, `our-lady-of-victory-basilica`.

Plus geocoding/verification backfill: all 38 cloud-agent churches geocoded; 4 of 5
`address_verified=false` rows confirmed and flipped to `true`.

## 6. Open items / where human input may be needed

### 6a. Genuinely disputed data (needs a human / on-site confirmation)
- **Immaculate Conception (Wellsville)** — house number unresolved. Parish site (icc-ics.com)
  says church = **36 Maple Ave**; gcatholic + Yelp + catholicchurch.directory say **6 Maple Ave**
  (office = 17). The OSM `place_of_worship` node sits closest to 36 (~48 m vs ~73 m to 17, ~85 m
  to 6), so the **map coordinate is pinned to the church node** and the line kept as "36 Maple
  Avenue", but `address_verified=false` is left on purpose. Human should confirm 6-vs-36 on site.
- **(Out-of-scope, pre-existing Rochester rows, flagged not fixed):** `sacred-heart-of-jesus`
  (Perkinsville) CSV `11114 Chapel St` vs sources' `11119`; `st-patrick-savannah` CSV
  `52 Clyde St` vs directories' `1583 Grand Ave`. Left for the Rochester data owner.

### 6b. Shared-domain families — the next tranche of work
The cleanest remaining work. **Resolution pattern (proven on Niagara Falls):** a "family" site
is usually a thin shell over 2–3 canonical parishes that *each* keep their own ParishesOnline
bulletin org and often their own domain. When that's true it splits cleanly — one `parish` row
per canonical parish, each with its own unique website + bulletin — satisfying both the
1-parish=1-bulletin rule and the UNIQUE-website constraint. The work is: confirm each canonical
parish's own homepage/bulletin org, then split. Only model the whole family as ONE parish when
there is genuinely a single combined bulletin and no per-parish sites (the tonawanda-catholic /
cheektowaga / enchanted-mountains case). Addresses already captured below:

- **The Lord's Vineyard** (thelordsvineyard3.com, N. Chautauqua) beyond Holy Trinity/Dunkirk —
  St. Anthony (66 Cushing St) + St. Joseph (145 E Main St) Fredonia share one bulletin
  ("The Catholic Parishes of Fredonia", parishesonline `st-anthony-st-joseph-churches`); family also
  has Our Lady of Mount Carmel (Silver Creek), St. Elizabeth Ann Seton & Blessed Mary Angela (Dunkirk).
- **Fields of Grace** (fieldsofgrace.family, Wyoming) beyond St. Michael/Warsaw — St. Vincent
  (Attica), St. Joseph (Varysburg), St. Cecilia (Sheldon), St. Mary (Pavilion), now partly
  reorganized into the new **St. John Neumann Parish** — needs the post-reorg split pinned down.

### 6c. Parishes in active closure/merger flux — DEFERRED until status settles
- **St. John Kanty** (Buffalo, 101 Swinburne St) — final Mass May 2025, Vatican suspended the
  closure pending a 90-day appeal.
- **All Saints** (Lockport, 76 Church St) — merged into St. John the Baptist by Vatican decree
  (Jul 2025), under appeal.
- **Jamestown / Holy Apostles + St. James** — Vatican overturned the merger decree Dec 2025;
  worship-site lineup unsettled as of mid-2026.
- **St. Mary** (18 Ellicott St, Batavia) — on the diocese's Road-to-Renewal closure list; only
  St. Joseph was added under `resurrection-batavia`.
- **Blessed Sacrament** (Kenmore) — appears merged into St. John the Baptist's site (would
  double-count). **Holy Spirit** (North Collins) — conflicting homepages (cfhrosary.org vs icchsc.org).

### 6d. Out of scope (decided, not deferred)
- **St. Casimir** (Buffalo, Kaisertown, 160 Cable St) — independent/non-diocesan Polish church,
  multiple sources say not associated with the Diocese. Project Carlo tracks Diocese of Buffalo, so excluded.

### 6e. Dead-domain audit — RECOMMENDED follow-up
While resolving ONE Catholic, three parish domains the cloud agent had treated as "own site"
turned out to be **dead/expired and in some cases squatted**: `holyfamilyalbion.com` (now a casino
spam site), `stmarystmark.org` (301s to an unrelated Indonesian site), `holytrinitymedina.org`
(DNS no longer resolves). Under the 1-parish=1-bulletin rule the parish website must be where the
bulletin actually lives, so a dead website is a real defect. **Recommend a liveness sweep of every
Buffalo parish website** (DNS-resolve + HTTP 200 + content sanity-check) to catch any other rows
whose domain has lapsed since the cloud agent added it; re-point or consolidate as needed. This is
also where a human may want to weigh in: when a parish's own domain dies and it falls back to a
shared family bulletin, the call to fold it into the family parish (as done for Holy Family/Albion)
is a judgment about current reality vs. the parish's prior independence.

## 7. How to continue (same method)

1. Pick a city/Family of Parishes. Research with `WebSearch` + `WebFetch` (both work here);
   fall back to `gcatholic.org` for address + Plus Code when a parish host 403s.
2. Cross-check each address against a 2nd independent source before `address_verified=true`.
3. Decide parish-vs-worship-site by **who publishes the bulletin** (§1): shared bulletin/site →
   one parish + many churches; own bulletin/site → its own parish.
4. **Geocode inline** (Nominatim works here; Plus-Code-decode + reverse-geocode fallback). Don't
   leave coordinates blank — that was only the cloud agent's constraint.
5. Append via a writer that validates global `slug` + `website` uniqueness, then
   `uv run python -m pdf_extract db create` + `uv run pytest` (expect 117 passed), commit per batch,
   and log the batch + any new edge cases back into this file.

The full diocese is ~160 parishes / ~36 Families; this is a verified slice covering all 8 counties,
not yet the whole diocese.
