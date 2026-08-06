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

**Dataset: 142 parishes / 257 churches; 117 tests green.** (Rochester baseline was 62/132.)

**Buffalo contribution: 80 parishes / 125 churches, all geocoded**, spanning **all 8 counties**.

Measured against the diocese's own parish finder — 167 locations, which reduce to **153 real
worship sites** once the 12 entries in `data/buffalo_excluded_sites.csv` are removed and the 2
the feed repeats are collapsed — the dataset now covers **121 of 153, or 79%**. The uncovered
remainder is 32 sites across 28 canonical parishes, every one deferred for a concrete,
individually-documented reason (§6f): overwhelmingly "the parish's website is dead or the diocese
lists none", not "not looked at yet".

Note the parish count *fell* while coverage rose. That is the expected direction: several batches
found that rows we already had were members of one bulletin and collapsed them (§4b). Parish count
is not a progress metric here — church coverage is.

**Recompute these numbers, don't trust this paragraph** — the diocesan feed changes underneath you:

```
uv run python scripts/fetch_diocese_locator.py https://www.buffalodiocese.org/parish-finder/ -o dio.json
uv run python scripts/reconcile_diocese_roster.py dio.json --list
```

`data/buffalo_excluded_sites.csv` is what keeps that number honest. **The diocese goes on listing a
church for months or years after its last Mass** — six of the sites in this file are closed
buildings still in the live feed — so without a machine-readable exclusion list the "what's left"
count silently overstates the work and invites someone to go re-research a demolished parish. Each
row carries its reason, its evidence and the date decided; add to it whenever a site is ruled out
for good, and never delete a row to make the number look better.

`db create` and `pytest` are run after every batch and must stay green.

## 4a. The bulk method (supersedes per-parish research)

The first ~37 parishes were built one at a time from `WebSearch`. That works but is slow and
re-derives facts the diocese already publishes. Everything from commit `e556743` onward uses a
**bulk join of two authoritative sources**, which is both faster and more accurate:

1. **The diocese's own parish finder** — `buffalodiocese.org/parish-finder/` runs the WordPress
   "WP Store Locator" plugin, whose `store_search` AJAX action returns **all 167 worship sites**
   in one unauthenticated request: name, street, city, zip, phone, coordinates, homepage. Crucially
   the location name encodes the structure we model:
   `"St. Mary of Lourdes [2008] – Our Lady of Lourdes Worship Site"` = canonical parish + year +
   worship site. Script: `scripts/fetch_diocese_locator.py`.
2. **GCatholic's diocesan roster** — `gcatholic.org/churches/local/buff0` lists 205 churches, each
   detail page carrying a second independent address **and an Open Location Code (Plus Code)**.
   Decoding the Plus Code locally yields building-precise coordinates with **no geocoder call at
   all**. Script: `scripts/fetch_gcatholic_roster.py` (includes a self-contained OLC decoder,
   checked against Google's reference code `849VCWC8+R9`).

**The grouping key is the *effective* website domain, after following redirects.** This is the
mechanical form of the §1 rule: one website = one bulletin = one parish row, and it satisfies the
UNIQUE-website constraint by construction. It also self-corrects the hardest modelling call —
a parish whose vanity domain now 301s into a family site has, by that very fact, folded into the
family bulletin and must **not** become its own row. That is how `st-josaphat.com`, `stamelia.com`,
`resurrectionbatavia.com` etc. correctly resolved to existing family parishes rather than
duplicating them.

**Cross-validation instead of assertion.** The two sources are independent, so
`address_verified` / `name_verified` are set `true` only where both agree (40/51 and 45/51 in the
first bulk batch), and coordinates prefer the Plus Code only when it lands within 400 m of the
diocesan point. No pair disagreed by more than that.

**Dedup must run on both address and name.** Normalised-address matching alone missed 18 churches
already modelled under family parishes (address formatting differs: `20 Peoria Ave.` vs
`20 Peoria Avenue`); city+dedication matching alone missed 2 more (`St. Mary of the Angels` vs
`Basilica of St. Mary of the Angels`, Olean). Run both nets or you will duplicate worship sites.

**Slugs are city-suffixed by frequency, not by collision.** A dedication occurring more than once
anywhere in the diocese (or already in the dataset) gets a city suffix even when nothing collides
*yet*, so the deferred batches — which contain many more St. Marys and St. Josephs — can be added
later without renaming committed rows.

Caveat: the diocesan feed is only as fresh as the diocese keeps it. **13 of its listed homepages no
longer resolve at all** (§6f). Always run new URLs through `scripts/check_parish_websites.py`
before trusting them.

## 4b. Read the bulletin, not the websites (settles "family or not?")

§4a groups sites by effective domain. That is the right *first* pass, but it cannot answer the
case that actually blocks progress: **several live domains that nevertheless share one bulletin.**
Domain-grouping over-splits there, and the doc previously flagged this as the place where "the
mechanical rule is known to be insufficient".

The fix is to stop inferring and go read the artefact the rule is actually about. ParishesOnline
serves bulletins from an unauthenticated flat path,
`container.parishesonline.com/bulletins/<a>/<b>/<YYYYMMDD>B.pdf`, one PDF per Sunday.
`scripts/probe_bulletin_container.py` walks Sundays backwards to find the latest issue and prints
its first readable page. **A family bulletin's masthead simply lists its member parishes**, which
is direct evidence rather than inference:

> Central Niagara Catholic Family — All Saints · Our Lady of the Lake · St. Brendan on the Lake ·
> St. John the Baptist … *inside: p5 All Saints, p8 Our Lady of the Lake, p9 St. Brendan on the
> Lake, p10 St. John the Baptist*

Two signals together are conclusive, and they are cheap:

1. **The combined container is still publishing this week** → the family bulletin is current, not
   a historical arrangement.
2. **A member's own former container has gone silent** → that member folded in.

That pair is what settled Central Niagara, including the part domain-grouping got wrong: St. John
the Baptist and St. Brendan on the Lake both keep live, distinct, parish-looking domains, so every
website-based heuristic says "two parishes" — but there is one bulletin, so under §1 there is one
parish. **Where a live domain and the bulletin disagree, the bulletin wins.**

Two practical notes. A *missing* object in the container answers **403, not 404**, so "403 on
every Sunday" is the dead-container signal — always confirm against a container you know is live
before concluding from it. And many issues are scanned images with no extractable text; when that
happens, fall back to an older issue from the same container, which is usually text-native and
carries the same masthead.

Corollary for the shells: All Saints', St. Brendan's and the family's own `/bulletin` pages all
render the *identical* LPi widget with no PDF link in the HTML. Matching shells across sites is a
useful hint that they are fed by one container — but confirm it against the container itself.

## 4c. The diocese publishes its own structure — use it as the backbone

`scripts/fetch_diocese_family_list.py`. The diocese periodically re-issues a **Family of Parishes
assignment masterlist** as a dated PDF, currently *April 2026*. It is a two-level bullet list of
every family, its member parishes, and each parish's worship sites:

```
Family #14 (Fields of Grace)
 • St. John Neumann, Strykersville        <- a canonical PARISH
   ◦ St. Vincent, Attica                  <- a WORSHIP SITE of that parish
   ◦ St. Joseph, Varysburg
   ◦ St. Cecilia, Sheldon
 • St. Michael, Warsaw
   ◦ St. Mary, Pavilion
```

**This is the authority on structure, and it beats the parish-finder feed at it.** The feed is
better for addresses and coordinates, but it lags badly on which buildings still exist: it was
still listing St. Joseph/Fredonia, St. Rose of Lima/Forestville, St. Hedwig/Dunkirk and St. Mary
Queen of the Rosary/Strykersville long after each stopped being a worship site. The masterlist had
already dropped all four. **Where the two disagree about structure, the masterlist is right.**

Two rules for using it:

- **A `◦` line is decisive.** "Worship site of X" means that building shares X's bulletin, so if X
  is already in `parishes.csv` the site can be added as a church row with no further research.
  This is the cheapest work in the whole backlog.
- **A Family is NOT automatically one bulletin**, and the bulletin is what we model (§1). Plenty of
  families here are 4–5 parishes that each publish separately — Family #7 and Family #16, for
  instance. Learn the structure here, then confirm the bulletin per §4b before collapsing a family
  into one row.

Used together the three sources are mutually checking, and agreement is worth a lot: Fields of
Grace, The Lord's Vineyard and Catholic Neighbors in Faith were each confirmed independently by the
masterlist and by the bulletin masthead, with the feed supplying the addresses.

Note the masterlist has no Family #13, and its trailing pages repeat family numbers next to schools
and chaplaincies; the parser stops at the first repeated number, so those are excluded.

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

- **Six worship sites under parishes we already had** (churches 251 → 257) — the first harvest of
  the §4c rule, and the cheapest batch in the project so far: no parish row touched, no bulletin
  hunted. Each had been deferred as "diocese lists no website" or "vanity domain dead", questions
  that stop mattering once the masterlist says the building is a *worship site* of a parish already
  modelled with a working website.
  - St. Mary (Canaseraga) → `st-patrick-belfast-fillmore`
  - St. Cecilia (Oakfield) + Holy Name of Mary (East Pembroke) → `resurrection-batavia`
    *(the feed still files these under the older "St. Padre Pio" and "St. Maximilian Kolbe" parishes)*
  - St. Margaret (Buffalo) → `st-mark-buffalo` *(its own domain returns HTTP 410)*
  - St. John Gualbert (Cheektowaga) → `st-stanislaus-buffalo`
  - Our Lady of the Angels (Cuba) → `catholic-communities-se-allegany`
- **Fields of Grace** (Wyoming/Genesee) — `fields-of-grace` (fieldsofgrace.family, container
  14/0954). Not a judgement call: the bulletin masthead and the diocese's April 2026 masterlist
  (§4c) list *the same* two parishes and five worship sites. So `eastern-rural-rcc` and
  `st-john-neuman` collapse into one row — which also retires ERRCC's ParishesOnline-org-page
  fallback website, since the family has a real homepage again. Sites: St. Michael (Warsaw),
  St. Cecilia (Sheldon), St. Vincent de Paul (Attica), St. Joseph (Varysburg), St. Mary (Pavilion).
  Parishes 143 → 142, churches 249 → 251.
  - This closes most of §6b's ERRCC entry. The old org name `st-michael-st-isidore` is stale
    branding: **St. Isidore is not in this family**, and its two sites (St. Mary/Silver Spring,
    St. Joseph/Perry) remain deferred with no bulletin home found.
  - **St. Mary Queen of the Rosary (Strykersville) removed as closed.** The parish is still *named*
    for Strykersville — which is what the parish-finder feed is reflecting — but the building is
    not one of its worship sites: the masterlist omits it, the current bulletin gives Mass times
    for the other five sites and none for it, local reporting has the site slated to be closed and
    sold, and OSM has no church node at 3854 Main Street.
- **The Lord's Vineyard** (N. Chautauqua) — the case §6f(f) called "the one place where the
  mechanical rule is known to be insufficient", closed by §4b. Container 14/1221 is still
  publishing and its masthead lists every member church under one banner → **one parish row**
  `the-lords-vineyard` (thelordsvineyard3.com), 5 worship sites: Holy Trinity + St. Elizabeth Ann
  Seton + St. Hyacinth (Dunkirk), Our Lady of Mount Carmel (Silver Creek), St. Anthony of Padua
  (Fredonia). The standing `holy-trinity-dunkirk` row collapsed in, as §6b anticipated.
  Churches 245 → 249.
  - **Three sites the diocesan feed still lists are excluded as closed**, each dated from the
    family's own churches page: St. Joseph (Fredonia) 24 Dec 2024; St. Rose of Lima (Forestville),
    last Mass 5 Jan 2025; St. Hedwig (Dunkirk) 8 Jun 2025. The masthead corroborates: St. Hedwig
    appears in the May 2025 issue and is gone by March 2026.
  - **Still open: Immaculate Conception (Cassadaga).** The diocese and GCatholic both place it
    under St. Anthony parish, but the family's current masthead and Mass schedule omit it
    entirely and no closure notice was found. Deferred rather than guessed either way.
- **Central Niagara + Catholic Neighbors in Faith** — two families resolved by reading the
  *bulletin itself* rather than the websites (§4b). Net: parishes unchanged at 143, churches
  237 → 245.
  - **`central-niagara-catholic`** (cncfwny.org, ParishesOnline container 14/0428) — a
    **restructure**: the family publishes ONE bulletin whose masthead carries all four member
    parishes with a page each, so the two rows we already had for members of it —
    `st-john-baptist-lockport` and `st-brendan-on-the-lake` — **collapse into this one row**,
    and the two members we were missing join as worship sites instead of becoming parishes.
    7 worship sites: All Saints + St. John the Baptist (Lockport), St. Patrick (Barker) +
    St. Joseph (Lyndonville), St. Bridget (Newfane) + Our Lady of the Rosary (Wilson) +
    St. Charles Borromeo Oratory (Olcott). Safe to merge: no bulletin or event in the dataset
    references a Buffalo parish yet, so nothing was orphaned.
  - **`catholic-neighbors-in-faith`** (cniffamily.org, Jamestown) — one bulletin over four
    canonical parishes, **5 active worship sites**: St. James + St. John + Ss. Peter and Paul
    (Jamestown), Sacred Heart (Lakewood), St. Patrick (Randolph).
  - Two sites removed from the deferred list as **closed, not deferred**: Our Lady of Loreto
    (Falconer, closed 19 May 2025) and Our Lady of the Snows (Panama) — the family's own
    parishes page lists the first as closed and does not list the second at all, though the
    diocesan feed still carries both. Our Lady of Victory Oratory (Frewsburg, closed 13 Jan 2025)
    was already absent from the feed.
- **Bulk batch 1** (commit `e556743`) — **44 parishes / 51 churches** in one pass via §4a, plus
  three churches folded into existing parishes on redirect evidence: St. Mary (Batavia) and Our
  Lady of Mercy (LeRoy) under `resurrection-batavia` (both domains 301 to the12apostles.org), and
  Our Lady of Pompeii (Lancaster) under `st-mary-assumption-lancaster` (olpparish.com 301s to
  stmarysonthehill.org). Includes the first multi-site parishes found this way:
  `st-brendan-on-the-lake` (St. Bridget/Newfane + Our Lady of the Rosary/Wilson + St. Charles
  Borromeo Oratory/Olcott), `st-john-neumann` (Strykersville + Sheldon), and
  `st-patrick-belfast-fillmore` (two churches both dedicated to St. Patrick).
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

- ~~**The Lord's Vineyard** (thelordsvineyard3.com, N. Chautauqua)~~ **— RESOLVED** as one
  `the-lords-vineyard` row with 5 worship sites; `holy-trinity-dunkirk` folded in. The question
  this entry posed — "does Holy Trinity still print its own bulletin?" — was answered by reading
  the container, not by inspecting domains. See §6f(f).
- ~~**Eastern Rural RCC (ERRCC)** (errcc.org, Wyoming/Genesee)~~ **— RESOLVED as `fields-of-grace`.**
  The "fuzzy roster" this entry complained about was the org name misleading us: `st-michael-st-isidore`
  is stale branding, and the family is actually St. John Neumann + St. Michael. **St. Isidore is not
  in it.** Its two sites (St. Mary/Silver Spring, St. Joseph/Perry) are still deferred — the
  masterlist (§4c) does not place them under any family, so they need their own bulletin home found.
- **Resurrection / The 12 Apostles** (the12apostles.org, Batavia) — `resurrection-batavia` currently
  has only St. Joseph (303 E Main St). Resurrection has since absorbed Padre Pio (Oakfield), Holy Name
  of Mary (East Pembroke), and Ascension (Batavia, slated to close then kept open). Add these worship
  sites once addresses + final merger status are confirmed.

### 6c. Parishes in active closure/merger flux — DEFERRED until status settles
- **St. John Kanty** (Buffalo, 101 Swinburne St) — final Mass May 2025, Vatican suspended the
  closure pending a 90-day appeal.
- ~~**All Saints** (Lockport) — merged into St. John the Baptist by Vatican decree, under appeal.~~
  **— RESOLVED.** The canonical appeal turned out to be the wrong thing to wait on: whatever its
  canonical status, All Saints appears as a member parish with its own page in the *current*
  Central Niagara Catholic Family bulletin, so §1 places it as a worship site of
  `central-niagara-catholic`. **Lesson: wait on the bulletin, not on the decree.** A merger under
  appeal can leave the bulletin arrangement completely settled, and the bulletin is what we model.
- ~~**Jamestown / Holy Apostles + St. James** — Vatican overturned the merger decree Dec 2025.~~
  **— RESOLVED** the same way: all four Jamestown-area parishes share the Catholic Neighbors in
  Faith bulletin regardless of the overturned decree → one `catholic-neighbors-in-faith` row.
- **St. Mary** (18 Ellicott St, Batavia) — on the diocese's Road-to-Renewal closure list; only
  St. Joseph was added under `resurrection-batavia`.
- **Blessed Sacrament** (Kenmore) — appears merged into St. John the Baptist's site (would
  double-count). **Holy Spirit** (North Collins) — conflicting homepages (cfhrosary.org vs icchsc.org).

### 6d. Out of scope (decided, not deferred)

**This list now lives in `data/buffalo_excluded_sites.csv`**, one row per site with its reason,
evidence and the date decided, so `reconcile_diocese_roster.py` can subtract it automatically
rather than relying on someone reading this prose. Currently 12 entries in two classes:

- **not-a-parish (6)** — the St. Gianna Molla pregnancy centers (Buffalo, Lackawanna, Cheektowaga,
  Niagara Falls, Fredonia, Perry, Olean). They share the diocesan parish finder but are
  social-service offices and publish no bulletin.
- **closed (6)** — St. Mary Queen of the Rosary (Strykersville), Our Lady of Loreto (Falconer),
  Our Lady of the Snows (Panama), St. Joseph (Fredonia), St. Rose of Lima (Forestville),
  St. Hedwig (Dunkirk). **Every one of these is still in the live diocesan feed.** That is the
  point of the file.
- ~~**St. Casimir** (Buffalo, Kaisertown, 160 Cable St) — independent/non-diocesan Polish church~~
  **— REVERSED (commit `e556743`).** The earlier call was wrong. The Diocese of Buffalo's *own*
  parish finder lists St. Casimir at 160 Cable St as a diocesan parish (founded 1891) with its own
  homepage `stcasimirbuffalo.com`, which resolves and serves parish content. Added as
  `st-casimir-buffalo`. Lesson worth keeping: prefer the diocese's own directory over third-party
  claims about jurisdiction.

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

### 6f. Complete deferred inventory (49 worship sites / 38 parishes)

This is a *closed* list, not an open-ended "rest of the diocese": every one of the diocese's
worship sites is either in the dataset, excluded as not-a-parish (§6d), or listed here.

**Regenerate it rather than reading the prose below** — the groupings are a snapshot, and the
diocese edits the feed:

```
uv run python scripts/reconcile_diocese_roster.py dio.json --list -o missing.json
```

The narrative groups (a)–(h) below are kept because they record *why* each site is blocked, which
the tooling cannot regenerate. Counts are as of the Central Niagara / CNIF batch; the group letters
still describe the shape of the remaining work even where a few members have since been resolved.

**Resolved out of this inventory since it was written:** All Saints (Lockport) and Our Lady of the
Lake's two sites → `central-niagara-catholic`; St. James, Holy Apostles' two sites, Sacred
Heart/Lakewood and St. Patrick/Randolph → `catholic-neighbors-in-faith`; St. Elizabeth Ann Seton,
St. Hyacinth, Our Lady of Mount Carmel and St. Anthony of Padua → `the-lords-vineyard`.

**Excluded as closed** (the diocesan feed still lists all of these): Our Lady of Loreto (Falconer),
Our Lady of the Snows (Panama), St. Joseph (Fredonia), St. Rose of Lima (Forestville), St. Hedwig
(Dunkirk). A site being in the feed is not evidence it is open — the families' own pages and
bulletin mastheads are, and they disagree with the feed often enough to check every time.

**(a) Diocese lists no website — 21 sites.** These need a bulletin home found by hand. Several are
clearly worship sites of a parish already named, which is the cheapest place to start:
Our Lady of Mt. Carmel (Silver Creek) + St. Rose of Lima (Forestville); Our Lady of the Lake —
St. Patrick (Barker) + St. Joseph (Lyndonville); St. Isidore — St. Mary (Silver Spring) +
St. Joseph (Perry) *(these two are ERRCC, §6b)*; St. Anthony (Fredonia) + Immaculate Conception
(Cassadaga); Sacred Heart — Our Lady of the Snows (Panama); SS. Peter & Paul (Arcade) + St. Mary
(East Arcade). Singles: Our Lady of Czestochowa (Cheektowaga), St. John Gualbert (Cheektowaga),
Queen of Angels (Lackawanna), St. Andrew Kim (Tonawanda), Holy Family (Tuscarora Reservation,
Sanborn), Holy Spirit (North Collins), St. Jude (Sardinia), St. Brigid (Bergen), St. Patrick
(Randolph), Our Lady of Loreto (Falconer).

**(b) Vanity domain no longer resolves — 19 sites / 13 parishes.** DNS is NXDOMAIN, so the
diocese's link is simply stale. Per the ERRCC precedent (§6e) the fix is to point `website` at
wherever the bulletin actually lives now — usually a ParishesOnline org page or a family site:
St. Andrew (Sloan), St. John XXIII (West Seneca), Epiphany of Our Lord (Langford), St. Joseph
(Holland), St. Joseph (Gowanda), Our Lady of Peace (Salamanca), Our Lady of the Angels (Cuba),
St. Mary (Canaseraga), Holy Name of Mary (Ellicottville), SS. Joachim and Anne (St. Joseph/
Varysburg + St. Vincent/Attica), Mary Immaculate (IC/East Bethany + St. Mary/Pavilion),
St. Dominic (St. Patrick/Brocton + St. James Major/Westfield), St. Mary of Lourdes (St. Mary/
Mayville + Our Lady of Lourdes/Bemus Point).
*Checked and ruled out:* GCatholic offers an alternate homepage for only one of these
(Sacred Heart/Lakewood → `sacredheartlakewood.org`), and that domain is dead too.

**(c) Domain squatted or parked — 4 sites.** Saint John Paul II (Lake View, `jp2parish.org` →
togel spam), Saint Maximilian Kolbe / Holy Name of Mary (East Pembroke, `stmax.net` → Indonesian
gambling site), Sacred Heart (Lakewood, `sh.thischurch.org` → vendor template), St. Margaret
(Buffalo, HTTP 410 Gone). Same fix as (b).

**(d) Website is a social page only — 2 sites.** Our Lady of Perpetual Help (Buffalo, Facebook
only) and Christ Our Hope / St. Matthias (Clymer, Google Sites behind a login redirect). Needs a
decision on whether a Facebook page can be the `website` when it is genuinely where the bulletin
is posted.

**(e) Genuinely in flux — 7 sites.** Unchanged from §6b/§6c and still the right call to wait:
Holy Apostles (St. John + SS. Peter and Paul, Jamestown) and St. James (Jamestown); All Saints /
St. Mary (Lockport); Ascension (Batavia); St. Padre Pio (St. Cecilia/Oakfield + Our Lady of
Fatima/Elba). Note the diocese *does* still list Ascension and St. Padre Pio as their own parishes,
which contradicts the earlier note that Resurrection had absorbed them — worth re-checking before
modelling either way.

**(f) Lord's Vineyard — RESOLVED, and it was the test case for §4b.** Formerly "the one place
where the mechanical rule is known to be insufficient": Blessed Mary Angela / St. Hyacinth,
St. Elizabeth Ann Seton and St. Joseph / Fredonia each had their own live domain, so per-domain
grouping said "split", while §6b's evidence of a shared bulletin org said "don't". Reading the
container settled it in one step — one bulletin, one row, five worship sites — and incidentally
showed St. Joseph / Fredonia had closed on 24 Dec 2024, so the domain that provoked the whole
question belonged to a church that no longer exists. **Where domains and the bulletin disagree,
the domains are the stale signal.**

**(g) Would duplicate existing rows — 2 sites.** St. John (Olean, `sjteolean.org`) and St. Mary of
the Angels (Olean, `smaolean.org`) are already modelled as worship sites of
`enchanted-mountains-catholic`. The diocese lists them as *separate parishes with their own live
domains*, which under §1 argues for splitting `enchanted-mountains-catholic` into per-parish rows.
That is a restructure of existing data, not an addition — deliberately not done here.

**(h) Cathedral — 1 site.** St. Joseph Cathedral (50 Franklin St) is listed under
`buffalodiocese.org` itself, which is the diocese's site and cannot be a parish `website` (it would
collide and is not where a parish bulletin lives). Needs the cathedral's own bulletin home.

### 6g. Dead end worth recording: the ParishesOnline API

Groups (b)–(d) all reduce to "find the bulletin org", so a bulk source for that was worth chasing.
ParishesOnline's SPA calls an unauthenticated API at
`https://f2141mdwk2.execute-api.us-east-1.amazonaws.com/prod/organizations` (the shipped
`X-API-KEY` is the literal string `"MISSING_ENV_VAR".API_KEY`, i.e. `undefined`, and the endpoint
answers without it). **It is not usable for bulk work:** `limit` is honoured but `page`, `offset`
and `skip` are all ignored, the response caps out around 3,000 records with a 502/504 beyond that,
and `latitude`/`longitude`/`state` filters are ignored — that slice contains only 5 WNY
organisations. Per-slug lookup (`/organizations/slug/<slug>`) 404s from outside the app. So
resolving (b)–(d) stays per-parish research; don't re-derive this.

## 7. How to continue (same method)

**For a new diocese**, run the bulk method (§4a) — it is the fast path and it produced 44 parishes
in one pass:

```
uv run python scripts/fetch_diocese_locator.py <diocese parish-finder URL> -o scratch/dio.json
uv run python scripts/fetch_gcatholic_roster.py <gcatholic key, e.g. buff0> -o scratch/gcat.json
```

Then: probe every candidate domain for liveness **and redirect target** → group sites by the
*effective* domain → drop groups whose domain is dead/squatted → dedup against `churches.csv` on
**both** normalised address and city+dedication → emit rows, city-suffixing any dedication that
occurs more than once in the diocese → validate `slug`/`website` uniqueness → `db create` +
`pytest` → commit per batch → log the batch and any new edge cases here.

**For the rest of Buffalo**, the bulk method is exhausted: §6f is a closed list of all 60 remaining
worship sites, and every one of them is blocked on the same per-parish question — *where does this
parish's bulletin live now that its domain is gone?* Work group (a) and (b) of §6f parish by parish
with `WebSearch`; ParishesOnline's API is a dead end for this (§6g). Steps 1–4 below are still the
right per-parish procedure:

1. Pick a parish from §6f. Research with `WebSearch` + `WebFetch` (both work here);
   fall back to `gcatholic.org` for address + Plus Code when a parish host 403s.
2. Cross-check each address against a 2nd independent source before `address_verified=true`.
3. Decide parish-vs-worship-site by **who publishes the bulletin** (§1): shared bulletin/site →
   one parish + many churches; own bulletin/site → its own parish.
4. **Geocode inline** — decode the Plus Code from gcatholic (no network needed, see
   `decode_plus_code` in `scripts/fetch_gcatholic_roster.py`), or use Nominatim, which works here.
   Don't leave coordinates blank — that was only the cloud agent's constraint.

Coverage against the diocese's own parish finder is **100 of 160 worship sites (62%)**, all 8
counties. The residual 60 are enumerated exhaustively in §6f, so "what's left" is now a finite
checklist rather than an open-ended survey.
