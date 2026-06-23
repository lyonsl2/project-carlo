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

### Batch 3 — Niagara County + Tonawanda family completion (3 parishes, 4 churches)

`db create` 77→80 parishes, 149→153 churches; 117 tests pass.

| parish slug | church — address | website | provider |
|---|---|---|---|
| st-jude-the-apostle-north-tonawanda | St. Jude the Apostle — 800 Niagara Falls Blvd, North Tonawanda 14120 | stjudetheapostleparish.org | parishes_online (st-jude-the-apostle-catholic-parish) |
| tonawanda-catholic *(existing)* | Our Lady of Czestochowa — 64 Center Ave, North Tonawanda 14120 | (rcct.faith) | — |
| st-john-baptist-lockport | St. John the Baptist — 168 Chestnut St, Lockport 14094 | stjohnslockport.com | parishes_online (st-john-the-baptist-church-14094) |
| our-lady-of-peace-clarence | Our Lady of Peace — 10950 Main St, Clarence 14031 | olpclarence.org | parishes_online (our-lady-of-peace-roman-catholic-church) |

Edge cases / judgment calls:
- **St. Jude vs RCCT**: St. Jude appears in the RCCT "Family of Parishes" and has a
  page on rcct.faith, BUT it also runs a dedicated site (stjudetheapostleparish.org)
  and its own parishesonline org/bulletin. Modeled it as its **own parish** (own
  bulletin) rather than a worship site of `tonawanda-catholic`. Our Lady of
  Czestochowa, by contrast, has no independent site → added as a worship site under
  `tonawanda-catholic`. The Buffalo "Family of Parishes" grouping ≠ canonical merger,
  so I key the parish/church split on *who publishes the bulletin*.
- **Lockport**: All Saints Parish was merged into St. John the Baptist by Vatican
  decree (Jul 2025), currently under appeal ("partial victory"). Added only St. John
  the Baptist (clearly active). All Saints (76 Church St) deferred until its
  worship-site status settles.
- **Deferred — Niagara Falls RC Family of Parishes** (nfrcfparish.org): St. Mary of
  the Cataract's parishesonline org is the merged "Divine Mercy & St. Mary of the
  Cataract", and the homepage is a shared multi-parish family site. Needs the full
  NF family worship-site list before it can be modeled without guessing — deferred.

### Batch 2 — outer suburbs / Southtowns (6 parishes, 6 churches)

Added; `db create` 71→77 parishes, 143→149 churches; 117 tests pass. All six
addresses corroborated by `catholicchurch.directory` listings (+ parish sites).

| parish slug | church — address | website | provider |
|---|---|---|---|
| st-benedict-amherst | St. Benedict — 1317 Eggert Rd, Amherst 14226 | saintbenedicts.com | parishes_online (st-benedict-church-and-st-leo-the-great-church) |
| ss-peter-and-paul-hamburg | Saints Peter & Paul — 66 East Main St, Hamburg 14075 | sspphamburg.org | parishes_online (ss-peter-paul-church-14075) |
| immaculate-conception-east-aurora | Immaculate Conception — 520 Oakwood Ave, East Aurora 14052 | icchurchea.org | parishes_online (immaculate-conception-church-14052) |
| st-mary-of-the-lake-hamburg | St. Mary of the Lake — 4737 Lake Shore Rd, Hamburg 14075 | smolparish.org | (detect) |
| st-mary-swormville | St. Mary's — 6919 Transit Rd, Swormville 14051 | stmaryswormville.org | (detect) |
| st-aloysius-springville | St. Aloysius — 190 Franklin St, Springville 14141 | staloy.com | (detect) |

Edge cases:
- `st-benedict-parish` slug already exists (Rochester); used `st-benedict-amherst`.
  Its parishesonline org is a combined St. Benedict + St. Leo bulletin — fine, the
  schedule extractor attributes events per church.
- **St. Christopher (Tonawanda)**: upgraded `address_verified` false→true — the
  2660 Niagara Falls Blvd address is now corroborated by Yelp + catholicchurch.directory.
- **Deferred (merged/family homepages, need full-family mapping before they're clean):**
  - St. Josaphat (Cheektowaga) — homepage is the shared "Catholic Family of
    Cheektowaga" site; needs the whole family's worship-site list to model correctly.
  - Holy Spirit (North Collins) — conflicting homepages in snippets
    (cfhrosary.org vs icchsc.org); homepage unresolved.
  - Blessed Sacrament (Kenmore) — appears merged into St. John the Baptist's site;
    would double-count a worship site already added.

### Batch 1 — Buffalo core + inner-ring suburbs (9 parishes, 11 churches)

Added and verified `db create` (62→71 parishes, 132→143 churches; 117 tests pass).

| parish slug | church(es) | website | provider | notes / edge cases |
|---|---|---|---|---|
| st-joseph-university-buffalo | St. Joseph University Church — 3269 Main St, Buffalo 14214 | stjosephbuffalo.org | (detect) | UB South Campus ministry parish. Provider not obvious from snippets → left empty for `detect`. |
| st-john-baptist-kenmore | St. John the Baptist — 1085 Englewood Ave, Kenmore 14223 | stjohnskenmore.org | parishes_online (st-john-the-baptist-church-14223) | **ZIP conflict**: directory sites show both Kenmore/14217 and Buffalo/14223. Confirmed via follow-up search the church + school are 14223; the address straddles the Kenmore/Buffalo line. Used Kenmore + 14223. |
| st-gregory-the-great-williamsville | St. Gregory the Great — 200 St. Gregory Ct, Williamsville 14221 | stgregs.org | (detect) | On discovermass + parishesonline "supporter" (not a clean org id) → left empty for `detect`. |
| ss-peter-and-paul-williamsville | Saints Peter & Paul — 5480 Main St, Williamsville 14221 | ssppchurch.com | parishes_online (ss-peter-and-paul-church-14221) | Two sites exist (ssppchurch.com = parish, ssppwilliamsville.com = faith formation). Used the parish site. |
| tonawanda-catholic | St. Amelia — 2999 Eggert Rd, Tonawanda 14150; St. Christopher — 2660 Niagara Falls Blvd, Tonawanda 14150; St. Francis of Assisi Chapel — 71 Adam St, Tonawanda 14150 | rcct.faith | parishes_online (roman-catholic-community-of-the-tonawandas) | **Family of Parishes** (Road to Renewal #18): several merged worship sites under one org/bulletin → modeled as ONE parish with multiple `church` rows (mirrors existing "N.E.T. Catholic"). St. Amelia address corroborated by directory; St. Christopher + St. Francis pulled from a single aggregated snippet → `address_verified=false` pending `verify`. Other RCCT sites (St. Jude N. Tonawanda, Our Lady of Czestochowa, St. Andrew Kim mission) deferred to a later batch — addresses not yet cleanly confirmed. |
| nativity-of-our-lord-orchard-park | Nativity of Our Lord — 43 Argyle Pl, Orchard Park 14127 | nativityofourlordop.com | parishes_online (nativity-of-our-lord-church-14127) | School is at a different address (4414 S. Buffalo St) — did NOT use the school address. Church office at 43 Argyle Pl confirmed. |
| st-mary-assumption-lancaster | St. Mary of the Assumption — 1 St. Mary's Hill, Lancaster 14086 | stmarysonthehill.org | parishes_online (st-mary-of-the-assumption-church-14086) | **Disambiguation**: many "St. Mary, Lancaster" hits are Lancaster PA / Lancaster OH. Pinned to NY via stmarysonthehill.org + parishesonline ...-14086. |
| queen-of-heaven-west-seneca | Queen of Heaven — 4220 Seneca St, West Seneca 14224 | qofhchurch.org | parishes_online (queen-of-heaven-church) | A second domain (queenofheavenparish.org) hosts bulletins; used qofhchurch.org as homepage. |
| our-lady-of-victory-basilica | Our Lady of Victory Basilica — 767 Ridge Rd, Lackawanna 14218 | olvbasilica.org | parishes_online (our-lady-of-victory-basilica) | National shrine/basilica; the parish worship site is the basilica itself. |

Slug convention applied: where a dedication already exists in the Rochester data
(e.g. `st-christopher` in N. Chili), Buffalo churches are city-suffixed
(`st-christopher-tonawanda`) to keep the global `slug` UNIQUE constraint happy.

Coordinates left blank for all 11 churches → the `geocode` stage will backfill
(network-blocked here). Provider left blank for 2 parishes → `detect` will claim them.

## Summary & handoff

**Added so far: 18 Diocese of Buffalo parishes, 21 churches** (across 3 commits/
batches). Spread across Erie county (Buffalo, Amherst, Williamsville, Tonawanda,
North Tonawanda, Cheektowaga-area, West Seneca, Lackawanna, Orchard Park, Hamburg,
East Aurora, Lancaster, Springville, Clarence, Swormville) and Niagara county
(Lockport). Every batch rebuilds the DB cleanly and keeps all 117 tests green.

**What's intentionally NOT done here (and why):**
- **Coordinates** — every new church has blank `latitude`/`longitude`. Nominatim is
  blocked in this environment, so the `geocode` pipeline stage owns this on the next
  normal run (it already targets rows missing coordinates). Without coordinates the
  churches won't render on the map until that stage runs — that's the expected
  hand-off, not a defect.
- **Bulletin provider for ~5 parishes** — left empty so the `detect` stage (Playwright)
  resolves them live. Where research clearly exposed a parishesonline org id, it's
  filled in directly.

**To continue the expansion (same method):**
1. Pick a city/Family of Parishes; `WebSearch` "<parish> <city> NY catholic church
   address website" (WebFetch/curl are 403-blocked here — only WebSearch works).
2. Cross-check the address against a 2nd source (catholicchurch.directory,
   parishesonline, Yelp) before setting `address_verified=true`.
3. Decide parish-vs-worship-site by **who publishes the bulletin**: a Family with one
   shared bulletin → one `parish` + many `church` rows; a site with its own bulletin →
   its own `parish`.
4. Append via a csv-writer script that validates global `slug` + `website` uniqueness
   (see commit scripts), then `uv run python -m pdf_extract db create` + `uv run pytest`.
5. Commit per batch; log it here.

**Known follow-ups (deferred, documented above):** Niagara Falls RC Family of Parishes
(St. Mary of the Cataract et al.), Catholic Family of Cheektowaga (St. Josaphat et al.),
Holy Spirit/North Collins homepage ambiguity, Blessed Sacrament (Kenmore) merger,
All Saints (Lockport) post-merger status. The full diocese is ~160 parishes / ~36
Families, so this is a verified starting slice, not the whole diocese.
