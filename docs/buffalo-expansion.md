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

**Dataset: 99 parishes / 186 churches; 117 tests green.** (Rochester baseline was 62/132.)

**Buffalo contribution: 37 parishes / 54 churches, all geocoded**, spanning **all 8 counties**.
Only one intentional address flag remains open (Wellsville house number, §6). The parish count
dropped from its peak as the website audit (§6e) correctly *consolidated* several over-split rows.

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

Newest first. Full per-row reasoning is in git history (commit per batch); the load-bearing edge
cases are kept in §6. **Note:** the website-audit pass (§6e) restructured several rows the cloud
agent had added — `st-michael-warsaw` → folded into `eastern-rural-rcc`; `st-jude-the-apostle-
north-tonawanda` → folded into `tonawanda-catholic`; `holy-family-albion` → folded into
`one-catholic`; `resurrection-batavia` website → the12apostles.org. The batch-1–8 lists below
record the *original* additions; the audit entries record the corrections.

- **Website audit + St. Jude/Resurrection** (commit `d37b300`) — folded St. Jude into RCCT
  (`tonawanda-catholic`, now 5 worship sites); repointed Resurrection/Batavia to the12apostles.org.
- **St. Michael → ERRCC** (commit `a387442`) — dead domain stmichaelswarsaw2.com; St. Michael
  (Warsaw) is a worship site of the Eastern Rural Roman Catholic Community (`eastern-rural-rcc`,
  errcc.org, org st-michael-st-isidore). Other ERRCC sites deferred.
- **Niagara Frontier** (commits `693fb43`, `cac41c5`) — `niagara-frontier-catholic`
  (niagarafrontiercatholic.org): St. Peter (Lewiston) + St. Bernard (Youngstown) + Immaculate
  Conception (Ransomville, dead own-domain icransomville.org → merged in). St. Raphael omitted (closed).
- **ONE Catholic consolidation** (commit `ac8ecd8`) — collapsed into ONE parish `one-catholic`
  (onecatholic.org; combined bulletin since Dec 2023) with worship sites Holy Family/Albion,
  St. Mary/Medina, St. Mary/Holley. **Removed** the old `holy-family-albion` parish (its website
  holyfamilyalbion.com is now a squatted casino domain) and re-parented its church here. Excluded
  St. Mark/Kendall (closed/for-sale).
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

- **The Lord's Vineyard** (thelordsvineyard3.com, N. Chautauqua) — **4 canonical parishes / 5
  worship sites**, org `the-lords-vineyard`. `holy-trinity-dunkirk` is already in the dataset as its
  own parish, but its domain holytrinitydunkirk.org now 301s to thelordsvineyard3.com — so a human
  should decide whether Holy Trinity still prints its own bulletin or now shares the family's (if the
  latter, fold it in). Other sites: St. Anthony (66 Cushing St) + St. Joseph (145 E Main St) Fredonia
  share a combined bulletin (`st-anthony-st-joseph-churches`); Our Lady of Mount Carmel (Silver
  Creek); St. Elizabeth Ann Seton & Blessed Mary Angela (Dunkirk). Defer until the per-bulletin split
  across the 4 parishes is mapped.
- **Eastern Rural RCC (ERRCC)** (errcc.org, Wyoming/Genesee) — now modeled as `eastern-rural-rcc`
  with **only St. Michael/Warsaw** attached. ERRCC's combined bulletin (org `st-michael-st-isidore`,
  ParishesOnline 14/0954) also covers Mary Immaculate, St. Isidore (Perry/Silver Springs), St. Joseph,
  St. Mary, and overlaps the old "Fields of Grace" reorg into **St. John Neumann Parish**. Add the
  remaining ERRCC worship sites once their addresses + post-reorg status are confirmed (the roster is
  currently fuzzy — St. Isidore appears in two towns; St. Joseph/St. Mary cities unconfirmed).
- **Resurrection / The 12 Apostles** (the12apostles.org, Batavia) — `resurrection-batavia` currently
  has only St. Joseph (303 E Main St). Resurrection has since absorbed Padre Pio (Oakfield), Holy Name
  of Mary (East Pembroke), and Ascension (Batavia, slated to close then kept open). Add these worship
  sites once addresses + final merger status are confirmed.

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

### 6e. Website liveness audit — DONE (a re-run is the recommended periodic check)
Ran a DNS-resolve + HTTP + content sanity sweep over all 39 Buffalo parish websites
(`scripts/check_parish_websites.py`). The cloud agent had assigned several parishes an "own domain" that has
since **lapsed**, because it couldn't make HTTP requests to verify them. Findings and fixes:

**Dead domains (DNS non-existent), fixed:**
- `holyfamilyalbion.com` → now a casino-spam squat. Holy Family/Albion shares the ONE Catholic
  combined bulletin → folded into `one-catholic` (commit `ac8ecd8`).
- `icransomville.org` → non-existent. IC Ransomville shares the Niagara Frontier bulletin → folded
  into `niagara-frontier-catholic` (commit `cac41c5`). *(This was a row added earlier this session —
  the audit caught my own over-split.)*
- `stmichaelswarsaw2.com` **and** `saintmichaelwarsaw.org` → both non-existent. St. Michael shares
  the ERRCC combined bulletin → re-homed under `eastern-rural-rcc` (commit `a387442`). **Then the
  audit caught that `errcc.org` itself is now squatted** (all paths 301 to a lottery-spam site
  `inforesulthk.com`), so the ERRCC community currently has *no* working homepage. Repointed its
  website to the live ParishesOnline org page where its bulletin is actually published
  (`parishesonline.com/organization/st-michael-st-isidore`) — a deliberate, rule-honoring fallback
  ("website = where the bulletin lives") for a parish whose vanity domain has lapsed. A human may
  later swap in a new ERRCC homepage if/when they register one.
- (`stmarystmark.org`, `holytrinitymedina.org` were ONE Catholic constituents — also dead; handled
  by the `one-catholic` consolidation.)

**Own-domain now 301s to a family site (parish likely folded into the family bulletin):**
- `stjudetheapostleparish.org` → rcct.faith. St. Jude folded into `tonawanda-catholic` (commit `d37b300`).
- `resurrectionbatavia.com` → the12apostles.org. Repointed website (commit `d37b300`).
- `holytrinitydunkirk.org` → thelordsvineyard3.com. **Left for review** — see §6b (needs the Lord's
  Vineyard bulletin split before deciding whether to fold Holy Trinity in).

**False positives (live; flagged only by the crude content check):** `svdparish.org` is IPv6-only
(this host has no IPv6, so it "timed out" but is live); `rcct.faith`, `olpclarence.org`,
`blessedtrinitybuffalo.org`, `saintbopny.org`, `goodshepherdpendleton-campus.org` are JS-rendered
(little crawlable text); `staloy.com`, `emcatholic.org`, `icc-ics.com` return 403 to bots;
`smolparish.org`, `holyfamilyrcchurch.org` 404 on `/` but resolve and serve. All confirmed live.

**Recommended periodic re-run:** `uv run python scratchpad/liveness.py` (or fold it into the
pipeline) — parish domains in this diocese lapse frequently during the ongoing mergers, so a
quarterly liveness check will keep the "website = where the bulletin lives" invariant honest.
Where a dead domain means a parish has fallen back to a shared family bulletin, folding it into the
family parish (as done above) is the right call under 1-parish=1-bulletin, but a human may want to
confirm the parish hasn't simply moved to a new own-domain instead.

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
