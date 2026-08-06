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

**Settled policy calls (data owner, 2026-08-06).** These three came up repeatedly and are now
decided — apply them, don't re-litigate them:

1. **A social page may be a parish `website`** when it demonstrably *is* where the bulletin is
   posted. Check that it actually carries the bulletin before using it; a page that only exists is
   not enough. This unblocks parishes the diocese lists with a Facebook URL and no domain, starting
   with Our Lady of Perpetual Help (Buffalo).
2. **A closed church is removed from `churches.csv`** and recorded in the exclusion CSV, and its
   public URL is simply allowed to 404. No redirect to a sibling church, and no `closed` column on
   `church` — the schema stays as it is. (Church pages are prerendered per slug at
   `/churches/<slug>/`, so a removal does drop a crawlable URL; that is accepted. See
   `docs/seo-plan.md`.)
3. **The dataset tracks real worship sites, not the diocesan feed.** A site with solid multi-source
   evidence goes in whether or not the feed lists it — St. Pacificus Oratory (Humphrey) is the
   precedent. Coverage % is measured *against the feed*, so it is a floor on the diocese, not a
   description of the dataset.

## 3. Current state

**Dataset: 143 parishes / 282 churches; 117 tests green.** (Rochester baseline was 62/132.)

**Buffalo contribution: 81 parishes / 150 churches, all geocoded**, spanning **all 8 counties**.

Measured against the diocese's own parish finder — 167 locations, which reduce to **142 real
worship sites** once the entries in `data/buffalo_excluded_sites.csv` are removed and the 2 sites
the feed repeats are collapsed — the dataset now covers **140 of 142, or 99%**. The uncovered
remainder is 2 sites, and **neither is blocked on research**: both are live parishes we have
positively confirmed, held up by a schema constraint and by a closure date that has not arrived
(§6f(c)).

**Do not read that 99% as "done."** It is a statement about the *feed*, and the feed is the source
this project has the most machinery for. Two independent things have now gone wrong with it:

- **The feed cannot see a structural error.** An earlier claim that "every family in the diocese has
  now been probed" was wrong — §6f(b) held unread families whose member parishes we carry as
  separate rows, invisible precisely because every one of their worship sites was already modelled.
  Collapsing three parish rows into one changes no site, so coverage would not have moved.
- **The feed is not the diocese's only list of buildings.** §4e is a diocesan page of weekend Mass
  times, and diffing it against `churches.csv` found a live public Mass venue — Our Lady of Fatima
  Shrine, Lewiston — that is **not in the parish finder at all** and therefore cannot appear in this
  metric as either covered or missing. The denominator is a feed, not the diocese.

Note the parish count *fell* while coverage rose. That is the expected direction: several batches
found that rows we already had were members of one bulletin and collapsed them (§4b). Parish count
is not a progress metric here — church coverage is.

**Recompute these numbers, don't trust this paragraph** — the diocesan feed changes underneath you:

```
uv run python scripts/fetch_diocese_locator.py https://www.buffalodiocese.org/parish-finder/ -o dio.json
uv run python scripts/reconcile_diocese_roster.py dio.json --list
```

The reconciler now collapses the feed's repeated sites **before** matching. It used to spot repeats
only among rows it could not match, so the moment a repeated site got modelled — as St. Mary
(Mayville) and Our Lady of Lourdes (Bemus Point) just did — both of its feed rows counted as
covered and the tool reported "repeated 0" for a feed that still contained the repeat. Coverage
barely moved (127/154 vs 125/152 at the time) but the raw counts were wrong, and these counts are
the thing this project trusts over its own prose.

`data/buffalo_excluded_sites.csv` is what keeps that number honest. **The diocese goes on listing a
church for months or years after its last Mass** — sixteen of the sites in this file are closed
buildings still in the live feed, one of them (St. Joseph, Lyndonville) **demolished in 2023** and
another (Immaculate Conception, Cassadaga) a parish the diocese's own records index closed in
**2008** — so without a machine-readable exclusion list the "what's left"
count silently overstates the work and invites someone to go re-research a demolished parish. Each
row carries its reason, its evidence and the date decided; add to it whenever a site is ruled out
for good, and never delete a row to make the number look better. When the closed site is one we
had already modelled, delete the `church` row as well and let its `/churches/<slug>/` URL 404 (§2);
St. Mary (Batavia) is the worked example. Rows the feed *doesn't* list are
worth keeping too (St. Isaac Jogues, Sherman): the reconciler ignores them, but they stop the next
person re-deriving a closed church from GCatholic, which lags harder than the feed does.

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

**Signal 2 is only meaningful when signal 1 holds.** In Blessed Family 7 *every* member container
is dead — Fourteen Holy Helpers (14/0935), Queen of Heaven (14/1013) and St. John Vianney
(14/1022) all 403 on every Sunday — because the family moved off those containers, not because
anybody folded into anybody. A silent container is evidence of a fold-in only when there is a live
container to have folded *into*. Otherwise it just means the publisher changed.

**When there is no container to read, compare LPi widget ids.** Parish sites on LPi/WeConnect embed
`parishesonline.com/publicationWidget?type=bulletin&id=<18-char id>`, and that id *is* the
publication. Same id on two sites = one bulletin (how The 12 Apostles was settled); different ids =
two bulletins, even when a masterlist, a decree and a shared festival raffle all say one parish.
It costs one HTTP GET per site and works when every container in the family is dead.

Signal 2 is not only about containers. St. Casimir (Buffalo) keeps a live domain that links a
Google Drive folder of bulletins — four monthly PDFs whose newest is May 2025, while the family's
weekly bulletin has carried St. Casimir's Masses, collections and events every week since. Read
the dates, not the presence of a link.

That pair is what settled Central Niagara, including the part domain-grouping got wrong: St. John
the Baptist and St. Brendan on the Lake both keep live, distinct, parish-looking domains, so every
website-based heuristic says "two parishes" — but there is one bulletin, so under §1 there is one
parish. **Where a live domain and the bulletin disagree, the bulletin wins.**

Three practical notes. A *missing* object in the container answers **403, not 404**, so "403 on
every Sunday" is the dead-container signal — always confirm against a container you know is live
before concluding from it. Many issues are scanned images with no extractable text; when that
happens, fall back to an older issue from the same container, which is usually text-native and
carries the same masthead. And **the masthead is not always on page 1**: LPi wraps many bulletins
in a generic cover reflection, so the first readable page can be a homily about carbohydrates with
the member parishes printed underneath it or on page 2–3. The probe used to print only the first
readable page and therefore reported South Buffalo as anonymous; it now takes `--pages`. *A
container that looks anonymous is usually one page short, not a dead end.*

**Read the masthead in the same issue that announces the closure.** The bisect in the paragraph
below dates a closure by finding the issue where a code disappears. Cheaper still: a family that is
about to close a church usually *says so* in the last issues that still list it. South Buffalo's
13 Oct 2024 masthead names St. Thomas Aquinas and the same issue announces "the closing Mass at
St. Thomas Aquinas: Saturday, November 9th at 11:30 AM" — one fetch giving both the membership and
the date. And membership moves both ways: that masthead lists St. Thomas Aquinas and *not* Our Lady
of Perpetual Help, while the Jan 2025 one reverses both. **Quote the current masthead, never a
remembered one.**

Corollary for the shells: All Saints', St. Brendan's and the family's own `/bulletin` pages all
render the *identical* LPi widget with no PDF link in the HTML. Matching shells across sites is a
useful hint that they are fed by one container — but confirm it against the container itself.

**The Mass-times legend is a dated time series — use it to *date* a closure.** A family bulletin
abbreviates its worship sites to codes (`[BP]` Bemus Point, `[W]` Westfield …) and prints the
legend, with addresses, every week. Counting a code's occurrences across one issue per month turns
"is this building still open?" into a bisect: the Chautauqua container carried `[B]` Brocton and
`[S]` Sherman through February 2025 and neither afterwards, and narrowing to weekly issues landed
on the announcements themselves — *"[S] 8:30 AM CLOSING MASS … St. Isaac Jogues Church in Sherman"*
(23 Feb 2025) and *"[B] 6:00 PM CLOSING MASS … St. Patrick Church, Brocton"* (17 Mar 2025). That is
a closure **date from the parish's own hand**, which is exactly what `buffalo_excluded_sites.csv`
wants, and it costs a handful of PDF fetches. Two cautions: an occasional issue is a scanned image
with no extractable text (all counts read 0 — skip it, don't conclude from it), and a code's
*letter* can be reused by ordinary prose, so read the legend, not just the count.

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

- **A `◦` line is a good lead for *adding*, never grounds for *collapsing* — and it still needs a
  liveness check.** "Worship site of X" points you at a building to add under X, and it is the
  cheapest work in the backlog. But the earlier claim that "nothing else has to be true for it to be
  safe" is **false**, and St. Joseph (Lockport) is the counter-example: the April 2026 masterlist
  carries it as a `◦` worship site of All Saints, while the diocese's own September 2024 decision
  closed that campus, the Central Niagara family's current Mass schedule covers six buildings and
  none of them is St. Joseph, and the feed has already dropped it. **The masterlist lags too** — it
  is fresher than the feed on *structure*, which is what §4c is for, but it is not a statement that
  a building is still open. Confirm against the family's current Mass schedule before adding, which
  costs one fetch. Cheap does not mean free.
  **It is not good enough to delete a parish row that has its own bulletin.** Fourteen Holy Helpers
  is a `◦` under Queen of Heaven in the April 2026 masterlist *and* was canonically merged into it
  in June 2025, yet the two publish different bulletins (different LPi `publicationWidget` ids) and
  it keeps its own site, Mass schedule and ParishesOnline organization. §1 models the bulletin, so
  it stays its own row. The masterlist is the authority on *canonical structure*; the bulletin is
  the authority on what we model, and Buffalo is a diocese where the two are years apart.
- **A Family is NOT automatically one bulletin**, and the bulletin is what we model (§1). Plenty of
  families here are 4–5 parishes that each publish separately — Family #7 and Family #16, for
  instance. Learn the structure here, then confirm the bulletin per §4b before collapsing a family
  into one row.

Used together the three sources are mutually checking, and agreement is worth a lot: Fields of
Grace, The Lord's Vineyard and Catholic Neighbors in Faith were each confirmed independently by the
masterlist and by the bulletin masthead, with the feed supplying the addresses.

Note the masterlist has no Family #13, and its trailing pages repeat family numbers next to schools
and chaplaincies; the parser stops at the first repeated number, so those are excluded.

## 4d. The Road to Renewal summary sheets — a plan, and useful only as one

`buffalodiocese.org/wp-content/uploads/2024/09/Renewal-Timeline-and-Summary-Sheet.pdf`. Eight pages,
one per vicariate, each a **three-column verdict on every parish**: *Parishes open*, *Secondary
worship sites*, *Parishes/sites merging and closing*. Nothing else in this project enumerates the
diocese's intent for every building at once, and the middle column in particular is the answer to
"which of these buildings survives the merger?" — it is what identified St. Jude (Alfred) as the
surviving half of SS. Brendan & Jude, and St. Mary (East Eden) and St. Adalbert as surviving
worship sites. The same list is mirrored in press coverage (WKBW, News 4) if the PDF moves.

**It is a September 2024 plan, and the diocese has not executed it.** Treat every line as a
hypothesis to check, never as evidence. Four ways it is already wrong:

- It lists **St. Rose of Lima (Buffalo), St. John XXIII (West Seneca), St. John Vianney (Orchard
  Park) and Blessed Sacrament (Tonawanda)** as merging and closing. All four are live parishes with
  their own bulletins today, and three are `parishes.csv` rows added by earlier sessions on
  bulletin evidence.
- It dates two closures precisely — **St. Anthony (Fredonia) and St. Hyacinth (Dunkirk), both
  "Feb. 15, 2026"** — and neither happened. The Lord's Vineyard's current Mass Times page still
  lists both, which is why our five rows there are unchanged.
- It has **St. Mary (East Arcade)** closing; the Cattaraugus Creek bulletin still gives it Mass.
- It has **Our Lady of the Rosary (Wilson)** closing; the Central Niagara schedule still gives it a
  Saturday vigil and a weekday Mass.

So the rule is the same one §4b already states, pointed at a new document: **the plan says what the
diocese intended, the bulletin says what happened, and the bulletin wins.** Where the plan and the
current Mass schedule agree, you have two independent sources and can act; where they disagree, the
schedule decides. Used that way it is the best *lead generator* in the project — used any other way
it will have you deleting live churches.

## 4e. The two diocesan sources this project should have been using all along

Both are plain pages on `buffalodiocese.org`, both cover the whole diocese in one fetch, and neither
had been opened before this session. Between them they answer the two questions every batch actually
asks — *is this building still open?* and *is this parish gone?* — without a single per-parish
`WebSearch`. **Check both before doing any research on an individual site.**

**(1) `buffalodiocese.org/sunday-morning-mass-times/` — a diocese-wide liveness oracle.** A flat
`Parish | Locale/Town | Time` table of every Sunday-morning Mass in the diocese, with sibling pages
for Saturday afternoon and Sunday afternoon. It is the check §4d demands, at diocese scale instead
of one family at a time. In one pass it independently confirmed **St. George (West Falls)** at
Sun 10:30, **St. Jude's Chapel (Alfred)** at Sun 9:45 and **Holy Family (Sanborn/Tuscarora Nation)**,
had **no Cassadaga entry**, and listed **St. Rose of Lima (Buffalo), St. John XXIII (West Seneca),
St. John Vianney (Orchard Park) and Blessed Sacrament (Tonawanda)** — the four the Road to Renewal
plan says are closing (§4d) — as live. Two cautions. Its footer claims "updated as of May 5th,
2024" and that is **wrong in the useful direction**: it carries post-2024 merged names and a
`*NEW*` marker, so it is maintained but not re-dated; treat it as current and confirm anything
load-bearing. And it is a *Mass* list, so absence is not proof of closure for a building that only
hosts funerals — **St. Adalbert is absent and is open** (§6a).

Diff it against `churches.csv` directly; do not eyeball it. Normalise `&`/`and`, `St.`/`Saint`,
strip `Church|Parish|Basilica|Shrine|Oratory|Chapel|Campus`, split the slashed compound names
(`Resurrection / St. Cecilia`), and match on locale — **the page names hamlets where the feed names
towns** (Eggertsville for Amherst, Harris Hill for Williamsville, Athol Springs for Hamburg), which
produces about a dozen false positives you must resolve by hand before believing any of them.

**(2) `buffalodiocese.org/sacramental-records/` — the diocese's own index of dead parishes.** An
alphabetical table of every closed or merged parish, each with a date range and the parish now
holding its records: `Immaculate Conception, Cassadaga (1940-2008) | St. Anthony, Fredonia`. §4b
already treats "who holds the sacramental records" as strong fold-in evidence; this is that evidence
**published centrally for the entire diocese**, and it reaches back decades further than any Road to
Renewal document. It settled Cassadaga outright, and it independently corroborated three additions
made from other sources: `St. Mary, East Eden (1835-2008) | St. John the Baptist, Boston` (the
oratory attaches to Boston, not to Hamburg as the masterlist implies), `St. Adalbert (1886-2011) |
St. John Kanty` together with `St. John Kanty (1892-2025) | St. Stanislaus` (the chain that lands
St. Adalbert under `st-stanislaus-buffalo`), and `Our Lady of the Sacred Heart, Colden (1912-2008) |
St. George, West Falls`.

Read the closing date as *the parish's*, not *the building's* — they differ by years and the gap is
where mistakes live. St. Joseph (Perry) and St. Mary (Silver Springs) both close in the table in
2007/2008, when they merged into St. Isidore, but the *sites* went on hosting Mass until the 2024
decision. Conversely a parish can be listed as dead while its building is the survivor: St. John the
Baptist (Boston) closes in 2025 with records at SS. Peter & Paul, yet it still publishes its own
Mass schedule and keeps its `parishes.csv` row under the Fourteen Holy Helpers rule (§4c). **The
table tells you a corporation ended and where the paperwork went. It never tells you a building
is shut.**

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
`emcatholic.org`, `tcsfh.org` (403s to a browser UA too — a member parish's own site answered the
question instead, see §5), `lakeshorecatholicfc.org`. Reliable channels that never 403'd: `gcatholic.org` (addresses + Plus Codes),
`cheektowagacatholicfamily.org`, `nfrcfparish.org`, `blessedtrinitybuffalo.org`. **gcatholic.org
is the dependable independent fallback.**

## 5. What's been added (by county / batch)

Newest first. Full per-row reasoning is in git history (commit per batch); the load-bearing edge
cases are kept in §6. **Note:** the website-audit pass (§6e) restructured several rows the cloud
agent had added — `st-michael-warsaw` → folded into `eastern-rural-rcc`; `st-jude-the-apostle-
north-tonawanda` → folded into `tonawanda-catholic`; `holy-family-albion` → folded into
`one-catholic`; `resurrection-batavia` website → the12apostles.org. The batch-1–8 lists below
record the *original* additions; the audit entries record the corrections.

- **The residue, and what re-reading the masterlist found underneath it** — 5 church rows added,
  1 removed, 1 parish row added, 8 exclusions. Parishes 142 → 143, churches 278 → 282; coverage
  94% → **99%**, and §6f(c) drops from 9 sites to 2. The headline is not the coverage number
  though — it is that **§6f(a) and §6f(b) were both wrongly declared empty**, and re-running the
  two structural scripts before doing any research is what showed it. The batch then found **two
  diocesan sources nobody had opened** (§4e) which would have answered most of it in two fetches.
  - **§6f(a) was not empty: five `◦` worship-site lines sat under parishes we already model.**
    The previous session harvested six such lines and concluded the class was exhausted; the
    masterlist in fact still held St. Jude (Alfred), St. Mary Oratory (East Eden), St. Adalbert
    (Buffalo), St. George Chapel (West Falls) and St. Joseph (Lockport). Four became church rows;
    the fifth is closed (below). **The lesson is procedural: `reconcile_diocese_roster.py` cannot
    see this class at all**, because none of the five is in the parish-finder feed. The reconciler
    measures the feed, the masterlist is a different document, and a site missing from both our
    data *and* the feed is invisible to the only tool we routinely run. Re-diff the masterlist
    against `churches.csv` directly, every session.
  - **St. Jude Chapel, 299 Lower College Drive, Alfred** → `catholic-communities-se-allegany`, whose
    own Mass schedule at icc-ics.com lists exactly four sites (Wellsville, Cuba, Alfred, Belmont)
    and we had three. **A directory's street number can be a PO Box that lost its label:**
    DiscoverMass gives "1154 Lower College Dr.", and the parish's own bulletin masthead reads
    "Lower College Drive, **PO Box 1154**". Alfred University's chaplaincy page, the Newman Club and
    the OSM church node all say **299**, so the row is 299 with `address_verified=true`.
  - **St. Mary Oratory, 8175 East Eden Road** → `st-john-the-baptist-boston`, *not* the parish the
    masterlist files it under. The masterlist makes both St. John the Baptist (Boston) and St. Mary
    Oratory `◦` lines of SS. Peter and Paul (Hamburg), but stjohnrcchurch.org is titled "St. John
    the Baptist Parish **and St. Mary's Oratory**" and prints one Mass schedule covering both
    (Sat 4:00 St. John's, Sat 6:00 St. Mary's). §1 models the bulletin, so the oratory attaches to
    the row that publishes it — the Fourteen Holy Helpers rule, applied to an *addition* rather
    than a collapse.
  - **St. Adalbert Basilica, 212 Stanislaus Street** → `st-stanislaus-buffalo`. **Four Masses a
    year is still a worship site.** Its own live site says the basilica hosts Mass four times
    annually plus weddings and funerals and sends weekend liturgies to St. Stanislaus, and the
    diocese lists it as a surviving secondary worship site. Both flags `false` (§6a).
  - **St. George Chapel, 74 Old Glenwood Road, West Falls** → `immaculate-conception-east-aurora`,
    and this one was nearly recorded as a closure. Every closure source pointed one way — the
    diocese's own list has "St. George, West Falls" under *merged and closed*, and the East Aurora
    Advertiser reported the parish closing with the chapel kept "open for private prayer", which
    reads exactly like a building that no longer holds Mass. **The family's own site says
    otherwise:** wheatss.org lists "Memorare Chapel of the Immaculate Conception – West Falls,
    74 Old Glenwood Road, **Mass Times: Saturday 9 am**". *A closed parish is not a closed
    building* — here the 1912 original chapel outlived the church next to it and took over as the
    worship site under a new dedication. Check the family's Mass schedule before writing an
    exclusion row, not just the closure reporting.
  - **St. Andrew Kim (Tonawanda)** — a new parish row `st-andrew-kim-tonawanda` (bukoca.org),
    1 site at 9 O'Hara Road beside Cardinal O'Hara High School. The Korean personal parish for
    Western New York, in no family and in no masterlist, which is why the structural sources never
    surfaced it; it has a live site with its own Mass times (Sun 11:00, Wed 20:00) and mission
    Masses in Rochester and Syracuse. Feed, GCatholic and the parish site agree on the address.
  - **St. Joseph (Lyndonville) removed — burned in 2023 and demolished.** Fire on 28 Feb 2023, the
    diocese announced on 10 Jul 2023 that it would not be rebuilt, and Orleans Hub reported the
    wrecking crew on site. **The building does not exist and the diocesan feed still lists it**,
    which is the strongest single illustration of why the exclusion file has to exist. We had been
    carrying it as an active worship site with verified address and coordinates.
  - **Six more exclusions, all from the same re-read**: St. Brendan (Almond) sold, the other half
    of SS. Brendan & Jude; St. Joseph (Perry) and St. Mary (Silver Spring), both St. Isidore sites;
    Immaculate Conception (East Bethany); Our Lady of Fatima (Elba); St. Joseph (Lockport).
    - **A family bulletin's staff list is a fold-in record.** The Fields of Grace masthead gives
      Mass times for five worship sites, none in Perry or Silver Springs, and names
      "Pastor Emeritus (**St. Isidore Parish**)". A family that prints another parish's emeritus
      pastor has absorbed it — the same class of evidence as §4b's sacramental-records graveyard,
      and it sits on page 1.
    - **Our Lady of Fatima (Elba) retires an "undecided" entry from §6a.** The rule there is that
      nothing gets an exclusion row unless a source *says* it closed. The vicariate summary says
      it: "St. Padre Pio, Elba site" under merged and closed, with "St. Padre Pio, Oakfield" kept
      as the surviving site — and Oakfield is already `st-cecilia-oakfield`. Same for East Bethany,
      whose surviving twin is `st-mary-pavilion`. **These two were only ever blocked on a document
      nobody had opened** (§4d).
    - **GCatholic files a two-building parish as one record.** Its "Sts. Brendan and Jude" entry
      carries Alfred's street with Almond's zip and Almond's Plus Code, so it cannot arbitrate
      between the two sites and quietly implies the wrong one survives.
  - **Immaculate Conception (Cassadaga) excluded — the feed is eighteen years behind on this one.**
    It was the last §6f(c) entry that structural sources had never touched: in the feed as a worship
    site of St. Anthony, and in *nothing* else — not the September 2024 vicariate summary, not the
    April 2026 masterlist, not the Lord's Vineyard Mass schedule, which covers five buildings.
    §4e(2) closed it: `Immaculate Conception, Cassadaga (1940-2008) | St. Anthony, Fredonia`, with
    `St. John the Evangelist, Sinclairville (1948-2007)` folded into the same place. The feed also
    still hangs it off St. Anthony, which is itself now only a secondary worship site of Holy
    Trinity — **a site of a site, which should be read as a smell**.
  - **Holy Family (Tuscarora Nation) — researched to a finish, then blocked by our own schema.**
    Live and confirmed by the diocese itself (§4e(1), Sun 9:30 June–Aug / 10:00 Sept–May), a
    Barnabite-run predominantly Tuscarora parish founded 1953, in no family and in no diocesan
    planning document. Its real address is **5180 Chew Road, Sanborn 14132**; the feed's
    "Tuscarora Reservation, Sanborn **14174**" has no street and the wrong zip — 14174 is
    Youngstown, where the **Barnabite provincial house** is, so the feed is carrying the *order's*
    mailing zip for the parish. It has **no website of any kind**: `barnabites.com` is the order's
    site with no parish page and no Mass times, and the only social presence is a Facebook *group*.
    `parish.homepage_url` is `NOT NULL UNIQUE`, so there is no row we can honestly write. Left in
    §6f(c) as an open decision, not as unfinished research.
  - **Queen of Angels (Lackawanna) deferred on purpose, with a trigger date.** Open today — the
    diocesan Mass page gives Sun 10:00 and Sun 11:30 (Spanish), and Buffalo Mass Mob 58 is there on
    **9 Aug 2026** — and closing "near the end of the summer" per the Mass Mob and the Am-Pol Eagle
    (30 Jul 2026). Adding a row we would delete in three weeks is churn; excluding a church with
    Mass this Sunday is false. **Re-check after Labor Day 2026** and write the exclusion row then.
    Worth knowing the plan and the bulletin disagree on *who it merged into*: the vicariate summary
    files it under secondary worship sites without a parent, while OLV's own 2024-09-15 bulletin
    says it merges into **Our Lady of the Sacred Heart (Orchard Park)** for multi-cultural ministry.
    Use the bulletin (§4b) if it ever needs a parent.
  - **Our Lady of Fatima Shrine (Lewiston) — a live public Mass venue that is not in the feed.**
    Surfaced only by diffing §4e(1) against `churches.csv`; Sun 9:00 and 12:00, Barnabite-run like
    Holy Family. Not a parish, so nothing in the model fits it, and because it is absent from the
    parish finder it can never show up as "missing". New open question in §6f(f) — the point for
    now is that **the coverage denominator has a hole in it that the reconciler cannot report**.
- **The last three families: #29 Lakeshore, #22 Downtown Buffalo, #7 Blessed Family 7** — one
  collapse and two plain additions. Parishes 142 → 140 → 142, churches 275 → 278; coverage
  92% → 94%, and **§6f(b) is now empty**. The three went three different ways, which is the point:
  *a Family of Parishes predicts nothing about how many bulletins it has.*
  - **Lakeshore Catholic Faith Community** (#29) — `lakeshore-catholic-faith-community`
    (lakeshorecatholicfc.org, container 14/1884), **4 worship sites**, absorbing **three** standing
    rows: `most-precious-blood-angola`, `st-mary-of-the-lake-hamburg` and
    `st-francis-of-assisi-athol-springs`. Sites: St. Mary of the Lake (Hamburg), St. Francis of
    Assisi (Athol Springs), Most Precious Blood (Angola), St. John Paul II (Lake View, added).
    One page-1 Mass schedule over all four, one family office at 24 Prospect St, Angola.
    - **St. Anthony (Farnham) excluded as closed, dated to the week by the schedule itself.** It
      carried Masses through the 25 May 2025 issue and none from 1 June; from Nov 2025 the same
      bulletin lists it among the parishes whose *sacramental records* the family office merely
      holds — alongside St. Vincent de Paul (North Evans) and an Our Lady of Perpetual Help
      (Lake View, no relation to the South Buffalo one). **That records list is a graveyard**, and
      a useful one: it names former parishes the feed and GCatholic may still be carrying.
    - Note `stanthonysfarnham.org` no longer resolves, and the bulletin's weekly "St. Anthony
      Devotionals ... in the St. Francis church" kept the *name* alive after the *site* closed —
      the §4b warning about counting a name rather than reading the legend, in prose form.
  - **St. Joseph Cathedral** (#22) — `st-joseph-cathedral-buffalo`, its own row, **1 site**
    (50 Franklin Street). The family shares no bulletin: the cathedral publishes *The Cathedral
    Chronicle* in its own live container **14/1023**, whose masthead names the cathedral alone. The
    other four members of #22 were already separate rows and stay that way.
    - Website is `buffalocathedral.org`, which 301s to `buffalodiocese.org/st.-joseph-cathedral`.
      §6f(b) ruled out `buffalodiocese.org` and that still holds — but the cathedral's *own* domain
      is a different thing: it is unique, it is what the bulletin masthead prints, and the page it
      lands on carries a "Latest Bulletins" link to `parishesonline.com/find/st-joseph-cathedral-14202`.
      So the bulletin is reachable from it, which is all §1 asks.
  - **St. John XXIII** (#7) — `st-john-xxiii-west-seneca`, its own row, **1 site** (1 Arcade Street,
    West Seneca). §4c predicted this family publishes separately and it was right, but the evidence
    had to change shape: **all three ParishesOnline containers in the family are dead**, so the
    "member's channel went silent" test says nothing. See §4b — that signal only works when the
    *family's* container is live.
  - **Fourteen Holy Helpers deliberately NOT collapsed, against both the masterlist and a decree.**
    The April 2026 masterlist makes it a `◦` worship site of Queen of Heaven, and 14 Holy Helpers
    Parish was canonically merged into Queen of Heaven in June 2025. But the two sites embed
    **different** LPi `publicationWidget` ids — `0018000000Qbyz4AAB` vs `0018000000Qc02EAAR` — and
    14hh.org is a live parish site with its own Mass schedule, its own rectory and its own
    ParishesOnline organization (`fourteen-holy-helpers-church`). Two bulletins, so under §1 two
    rows. This **falsifies §4c's "a `◦` line is decisive"** in the collapsing direction; see the
    correction there.
- **The Catholic Family of South Buffalo** (Family #31) — a **restructure that removes two rows**:
  `catholic-family-south-buffalo` (catholicsouthbuffalo.com, container 14/0940) with **5 worship
  sites**, absorbing both `st-teresa-buffalo` and `st-martin-of-tours-buffalo`. Sites: St. Teresa,
  St. Martin of Tours, St. Ambrose, Holy Family, Our Lady of Perpetual Help (all Buffalo).
  Parishes 143 → 142, churches 272 → 275; coverage 91% → 92%.
  - The masthead is **at the foot of page 1, under an LPi cover reflection about carbohydrates** —
    which is why this container looked anonymous on the first probe. `probe_bulletin_container.py`
    only ever printed the first readable page, so it printed the homily. It now takes `--pages`
    (§4b). *A container that looks anonymous is usually one page short, not a dead end.*
  - Current masthead: "Our Lady of Charity • Our Lady of Perpetual Help • St. Martin of Tours •
    St. Teresa" — one bulletin, four parishes, therefore one row.
  - **This resolves the §6f(e) policy question by dissolving it.** Our Lady of Perpetual Help is
    the parish the diocese lists with a Facebook URL and no domain, and §2 policy 1 had just been
    settled to unblock it. It never needed the policy: it shares the family bulletin, so it is a
    worship site and needs no `website` of its own. **Settling a policy question is not the same as
    needing it** — probing the family first, as §6f(e) itself advised, was the cheaper path.
  - **Two feed entries that are worship sites under other names.** The feed's "Our Lady of Charity,
    260 Okell St" is the **St. Ambrose** building (the family's own site calls it "Our Lady of
    Charity – St. Ambrose"), which is why St. Ambrose looked absent from the feed while sitting in
    the masterlist. Holy Family is in neither the feed nor GCatholic, and is added on the family
    site, the masterlist and an OSM church node (the St. Pacificus precedent, §2 policy 3) — so
    churches rose by 3 while coverage rose by only 2.
  - **St. Thomas Aquinas (450 Abbott Rd) excluded as closed, dated from the bulletin both ways.**
    The 13 Oct 2024 masthead names it *and* announces "the closing Mass at St. Thomas Aquinas:
    Saturday, November 9th at 11:30 AM"; the 10 Nov masthead has dropped it; the 17 Nov issue says
    "Now that St. Thomas Aquinas has been closed". A masthead bisect is cheaper still when the
    bulletin announces the closure in the same issue it last lists the parish.
  - Correction worth recording: the 2024 masthead lists **St. Thomas Aquinas and not** Our Lady of
    Perpetual Help; OLPH first appears in the Jan 2025 masthead. The family's membership changed in
    both directions inside three months, so **quote the current masthead, never a remembered one**.
- **Cattaraugus Creek Catholic Community** (Family #33) — a **restructure**:
  `cattaraugus-creek-catholic` (ccccfamily.org, container 14/0156) with **4 worship sites**,
  absorbing the standalone `st-aloysius-springville` row. Sites: St. Aloysius (Springville),
  St. Mary (Arcade), St. Mary (East Arcade), St. Joseph (Holland). Parishes 143 → 143, churches
  269 → 272; coverage 88% → 91%. This one batch cleared **all** of §6f(a), one of the five
  families in §6f(b), and one entry each from (c) and (d).
  - **The container had already answered this, under its old name.** A search for the family turned
    up two PDFs in the *same* container `14/0156` — `20230423B` headed "St. Aloysius OF
    Springville" and `20231001B` headed "CATTARAUGUS CREEK CATHOLIC Community". A parish container
    that starts printing a family's name **is** the fold-in, recorded by the publisher. That is
    §4b's "member's own channel went silent" signal in its cheapest form: same channel, new
    masthead, no second container to find.
  - The current issue (2 Aug 2026) gives one Mass schedule over four buildings — St. Aloysius,
    St. Mary/Arcade, St. Mary/East Arcade, St. Joseph/Holland — under one "PARISH FAMILY OFFICE"
    and `www.ccccfamily.org`. The family describes itself as "two parishes united in faith", which
    is exactly the masterlist's structure (St. Mary/Arcade + St. Joseph/Holland) and, under §1,
    one row.
  - **The feed's "SS. Peter & Paul" and the masterlist's "St. Mary, Arcade" are the same
    building** — 417 W Main St. Both were on the deferred list, one in §6f(a) and one implicitly,
    which is how a single site can look like two open questions. GCatholic states it outright:
    church *name* "Sts. Peter and Paul", *parish* "St. Mary Parish". Modelled as St. Mary with
    `name_verified=false` (§6a).
  - **Two more closures, both from the family's own site**, and both were on the deferred list as
    live research: St. Jude (Sardinia) — final Mass 19 Oct 2024, still in the diocesan feed, listed
    in §6f(c) as "no family, no website" — and St. John the Baptist (West Valley), merged into
    St. Aloysius, absent from the feed but still carried by GCatholic. **A family's "our churches"
    page is a closure list as well as a roster**, and it is cheaper than the masthead bisect.
- **Catholic Family of the Holy Rosary** (Family #27) — a **restructure**:
  `catholic-family-holy-rosary` (cfhrosary.org, container 14/0937) with **3 worship sites**,
  absorbing the standalone `immaculate-conception-eden` row. Sites: Immaculate Conception (Eden),
  Epiphany of Our Lord (Langford), St. Joseph (Gowanda). Parishes 143 → 143, churches 267 → 269;
  coverage 86% → 88%.
  - **Two more closures, both dated by the bulletin, and the family shrank from five parishes to
    three inside six weeks:** Holy Spirit (2017 Halley Rd, North Collins) closing Mass 29 Dec 2024
    "with a solemn transfer of the Blessed Sacrament to Immaculate Conception", St. Mary
    (36 Washington St, Cattaraugus) closing Mass 12 Jan 2025. The Dec 2024 masthead lists five
    parishes; the Feb 2025 masthead lists three. **A masthead read once is a snapshot; read two and
    it is a changelog.**
  - This retires §6c's "Holy Spirit — conflicting homepages (cfhrosary.org vs icchsc.org)". The
    conflict was a sequence: `icchsc.org` was the Immaculate Conception + Holy Spirit Church
    pairing, `cfhrosary.org` is the family that replaced it.
  - St. Joseph (Gowanda) is one building with three addresses — 26 Erie St (feed, GCatholic),
    26 Erie Ave (the bulletin) and 67 East Main St (the OSM church node, 28 m from GCatholic's Plus
    Code). Modelled at 26 Erie Street, `address_verified=false`.
- **The 12 Apostles** (Family #12) — a **rename plus two additions and a removal**:
  `resurrection-batavia` becomes `twelve-apostles-catholic` (the12apostles.org unchanged) with
  **6 worship sites**. Added St. Brigid (Bergen) and Ascension (Batavia); removed St. Mary
  (Batavia). Parishes 143 → 143, churches 266 → 267; coverage 85% → 86%.
  - The row already pointed at the family site — it was named for one member parish while holding
    another's churches. **A row can be right about the bulletin and wrong about the name**, and the
    name is what the next person reads.
  - One bulletin, evidenced without a container: the site embeds a single LPi
    `publicationWidget` id (`0018000000QbzysAAB`) on one `/bulletin` page for a nav that lists four
    parishes. Both member domains confirm it — `ourladyofmercyleroy.org` 301s to the family site
    (settling the masterlist's claim that Our Lady of Mercy is its own parish: under §1 it is a
    worship site) and `ascensionrcc.weconnect.com` serves LPi's "Temporarily Unavailable" stub.
  - **St. Mary (18 Ellicott Street, Batavia) removed as closed** — last Mass 14 Aug 2024, absent
    from the family site, still in the diocesan feed. It had been added as an active site by an
    earlier batch, so this is the first row the exclusion file takes *back* out of `churches.csv`.
  - Ascension's worship site is **135 South Swan Street**; the feed's `19 Sumner St` is the parish
    *office*, which the family site says plainly and the feed's own coordinates confirm (they fall
    on Swan Street, not Sumner). GCatholic calls the Swan Street building Sacred Heart of Jesus, so
    both flags are `false` there.
- **Three Catholic Sisters of the Foothills** (Family #25) — a **restructure**:
  `three-catholic-sisters-foothills` (tcsfh.org) with **4 worship sites**, absorbing the standalone
  `st-philomena-franklinville` row. Sites: Holy Name of Mary (Ellicottville), St. Philomena
  (Franklinville), Our Lady of Peace (Salamanca), St. Pacificus Oratory (Humphrey). Parishes
  143 → 143, churches 263 → 266; coverage 84% → 85%.
  - **Settled without reading the container**, which is worth recording because `tcsfh.org` 403s to
    every fetcher (add it to the §4 blocklist). St. Philomena's own live site does the work: *"St.
    Philomena Parish is now part of the THREE CATHOLIC SISTERS OF THE FOOTHILLS FAMILY OF PARISHES
    … Click Here to be redirected to the New Website www.tcsfh.org … MASS TIMES (Check Bulletin —
    https://tcsfh.org/bulletins)"*. One bulletin page for all three, said by a member parish about
    itself, with the other two member domains (`maryellicottville.org`, `olpsal.org`) both dead and
    a single ParishesOnline organization for the family. **A member parish announcing its own
    folding-in is as good as the masthead** — the masthead is only ever a proxy for this.
  - **St. Pacificus Oratory (Humphrey) added although the diocesan feed has never listed it** — the
    April 2026 masterlist puts it under Holy Name of Mary, GCatholic carries it (with no address),
    the family site has a page for it, and OSM has the church node on Chapel Hill Road. Address
    4722 Chapel Hill Road from the parish's own page; `address_verified=false` since no second
    source gives the number and the OSM church node carries none. It does not move the coverage
    figure, which counts the feed — the feed is not the whole diocese.
  - Two disagreements left visible rather than resolved: GCatholic calls the Salamanca building
    **Holy Cross** where the diocese, OSM and the family call it Our Lady of Peace
    (`name_verified=false`), and its street number is 274 (OSM + family listing) or 284 (feed +
    GCatholic) — modelled at 274 on the OSM node, `address_verified=false`.
- **Roman Catholic Community of Cheektowaga-Kaisertown-Sloan** (Family #32) — a **restructure**:
  `cheektowaga-kaisertown-sloan-catholic` (olc-cheektowaga.com, container 14/0948) with **3 worship
  sites**, absorbing the standalone `st-casimir-buffalo` row. Sites: St. Casimir (Buffalo,
  Kaisertown), Our Lady of Czestochowa (Cheektowaga), St. Andrew (Sloan). Parishes 143 → 143
  (one added, one collapsed), churches 261 → 263; coverage 82% → 84%.
  - The family's homepage is `olc-cheektowaga.com` — a member church's domain that has become the
    community's site (it names all three churches and links the shared bulletin). The diocesan feed
    does not carry it; it lists `standrewsloan.com`, which no longer resolves.
  - **St. Casimir keeps a live domain with a bulletin link, and still folds in.** The link is a
    Google Drive folder holding four *monthly* PDFs, newest May 2025; the family's *weekly*
    bulletin has run continuously since and carries St. Casimir's Masses, collections and events.
    Same §4b test as Central Niagara, different shape of "own channel gone silent".
  - Address note: the family's own masthead gives Our Lady of Czestochowa as 23 Willowlawn Parkway
    while the feed, GCatholic and the parish site all say 2158 Clinton Street — the same corner
    building. Modelled at 2158 Clinton Street.
- **Chautauqua Family of Catholic Churches** (Family #5, the last whole family on the deferred
  list) — `chautauqua-family-catholic` (cfofcc.net, container 14/0681), **4 worship sites**:
  St. Mary (Mayville), Our Lady of Lourdes (Bemus Point), St. James Major (Westfield), St. Matthias
  (Clymer/French Creek). Parishes 142 → 143, churches 257 → 261; coverage 79% → 82%.
  - §6f called this "6 sites, all on dead or login-walled domains", "the single biggest remaining
    win", and the domains really are gone — `stmaryoflourdesrcparish.org` and `stdominicrcc.org`
    no longer resolve, and Christ Our Hope's Google Site 302s to a login. **None of that mattered.**
    The family has one bulletin, one central office and one live homepage the diocesan feed has
    never heard of, and a single web search for the family name found both. Three parishes, one
    bulletin, one row.
  - **Six buildings, four Masses.** St. Patrick (Brocton) closed 17 Mar 2025 and St. Isaac Jogues
    (Sherman) 23 Feb 2025 — both dated from the bulletin's own Mass legend (§4b) and recorded in
    `data/buffalo_excluded_sites.csv`. The feed still lists Brocton; GCatholic still lists *both*,
    Sherman under a parish that has not had it for over a year.
  - (§6f's "6 sites" for this family was a miscount of its own list, which named five feed sites.
    The reconciler's 32 was right; the prose was not. One more reason to regenerate the inventory.)
  - Address disagreement kept rather than smoothed: St. Mary/Mayville is `22 East Chautauqua Street`
    in the bulletin, in OSM's church node and in one of the feed's two rows for it, but `24` in
    GCatholic and the feed's other row. Modelled at 22, pinned to the OSM node, `address_verified`
    left `false` (§6a).
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
- **The Lord's Vineyard** (N. Chautauqua) — the case this doc once called "the one place where the
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
- **St. Mary (Mayville)** — house number **22 vs 24 East Chautauqua Street**. The parish's own
  weekly bulletin legend and the OSM `place_of_worship` node ("Saint Mary of Lourdes Catholic
  Church", 22) say 22, as does one of the diocesan feed's two rows for the site; GCatholic and the
  feed's other row say 24. Modelled as 22 with the coordinate pinned to the OSM node, and
  `address_verified=false` on purpose. Likely 24 is the office/rectory next door; a human can
  settle it on site.
- **St. Mary (Arcade), 417 West Main Street** — **dedication disputed, address not.** The family's
  own site, its bulletin Mass schedule and the OSM church node all call the building St. Mary; the
  diocesan feed and GCatholic call it Sts. Peter and Paul. GCatholic is the one source that gives
  both at once — church name "Sts. Peter and Paul", parish "St. Mary Parish" — which reads as the
  historic dedication of the building against the name of the 2007 merged parish now using it.
  Modelled as **St. Mary Church** (the name the parish itself and the map both use, and the name a
  visitor would look for) with `name_verified=false`. All four sources agree on 417 W Main St, so
  `address_verified=true`. A human could confirm what is actually carved over the door.
- **St. Ambrose (Buffalo)** — **260 Okell Street** (the diocesan feed and the parish's own site)
  vs **65 Ridgewood Road** (GCatholic). Nominatim puts the two ~76 m apart and OSM has a single
  `Saint Ambrose Church` node between them: one corner building with two street frontages, the
  St. Joseph (Gowanda) pattern. Modelled at 260 Okell Street, pinned to the OSM node,
  `address_verified=false`.
- **Holy Family (Buffalo)** — **1885 South Park Avenue** (OSM church node, Yelp,
  catholicchurch.directory and the Buffalo architectural survey at `buffaloah.com/a/spark/1885/`)
  vs **1901 South Park Avenue** (Our Lady of Charity's own site and masstime.us). Almost certainly
  the church vs the parish office next door — the St. Mary (Mayville) pattern. Modelled at 1885 on
  the OSM node, `address_verified=false`.
- **Our Lady of Perpetual Help (Buffalo)** — **115 O'Connell Avenue** (the feed *and* GCatholic
  agreeing) vs **125** (the OSM church node). Two independent sources would normally settle it,
  but the dissenter here is the OSM node itself, so it is modelled at 115 with
  `address_verified=false` rather than quietly outvoting the map.
- **St. Adalbert (Buffalo)** — **212 Stanislaus Street** (GCatholic, the basilica's own site and the
  family site eastbuffalocatholic.org, all agreeing) vs **208** (the OSM church node). The OLPH
  pattern: three independent sources would normally settle it, but the dissenter is the map itself,
  so it is modelled at 212 pinned to the OSM node with `address_verified=false`. `name_verified` is
  also `false`, for a different and more interesting reason — **the "Basilica" in the name is
  disputed by the Vatican.** The church has been called St. Adalbert Basilica since a 1907
  affiliation with St. Peter's, but in 2025 the Congregation wrote to Bishop Fisher that the 1907
  document was a capitular decree granting *aggregation* for indulgences and "does not in any way
  equate to elevation to the rank of Minor Basilica." The diocese's masterlist and vicariate summary
  both call it plainly "St. Adalbert"; its own domain is saintadalbertbasilica.org. Modelled as
  **St. Adalbert Basilica**, the name a visitor searches for, with the flag left `false`.
- **St. George Chapel (West Falls, 74 Old Glenwood Road)** — **dedication disputed, address not.**
  The OSM church node and the April 2026 masterlist both call it St. George Chapel; the family that
  publishes its bulletin calls it "Memorare Chapel of the Immaculate Conception". Those are two
  different dedications, not two spellings, so `name_verified=false`. All three sources agree on the
  address, so `address_verified=true`.
- **St. Agatha (Buffalo, 54 Alamo Place)** — **left undecided, not excluded.** GCatholic still
  files it under Our Lady of Charity Parish; the family's own site does not list it among its
  worship sites, the feed and the April 2026 masterlist both omit it, and Overpass finds no
  `place_of_worship` node there. Everything points to closed and nothing *says* so, so it gets no
  exclusion row (which would assert a closure) and no church row. Same treatment as Our Lady of
  Fatima (Elba) and Immaculate Conception (Cassadaga): someone has to ask the parish.
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
  the container, not by inspecting domains. See §4b.
- ~~**Eastern Rural RCC (ERRCC)** (errcc.org, Wyoming/Genesee)~~ **— RESOLVED as `fields-of-grace`.**
  The "fuzzy roster" this entry complained about was the org name misleading us: `st-michael-st-isidore`
  is stale branding, and the family is actually St. John Neumann + St. Michael. **St. Isidore is not
  in it.** Its two sites (St. Mary/Silver Spring, St. Joseph/Perry) are still deferred — the
  masterlist (§4c) does not place them under any family, so they need their own bulletin home found.
- ~~**Resurrection / The 12 Apostles** (the12apostles.org, Batavia)~~ **— RESOLVED as
  `twelve-apostles-catholic`**, 6 worship sites. The row had been named for one member parish while
  already pointing at the family's site; it is now named for the family. Our Lady of Mercy (LeRoy),
  which the masterlist calls a parish of its own, keeps a domain that 301s to the family site, so it
  stays a worship site under §1.

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
- ~~**St. Mary** (18 Ellicott St, Batavia) — on the diocese's Road-to-Renewal closure list~~
  **— RESOLVED as closed**, last Mass 14 Aug 2024, and **removed from `churches.csv`**: it had been
  added as an active worship site before the closure was confirmed. Now in
  `buffalo_excluded_sites.csv`. Worth noting the direction — the exclusion file is not only for
  sites we never added.
- **Blessed Sacrament** (Kenmore) — appears merged into St. John the Baptist's site (would
  double-count).
- ~~**Holy Spirit** (North Collins) — conflicting homepages (cfhrosary.org vs icchsc.org)~~
  **— RESOLVED as closed**, 29 Dec 2024. The "conflict" was not one: `cfhrosary.org` is the family
  it belonged to and `icchsc.org` was the Immaculate-Conception-plus-Holy-Spirit pairing that
  preceded the family. Two homepages for one parish is often a *sequence*, not a contradiction.

### 6d. Out of scope (decided, not deferred)

**This list now lives in `data/buffalo_excluded_sites.csv`**, one row per site with its reason,
evidence and the date decided, so `reconcile_diocese_roster.py` can subtract it automatically
rather than relying on someone reading this prose. Currently 30 rows in two classes:

- **not-a-parish (7)** — the St. Gianna Molla pregnancy centers (Buffalo, Lackawanna, Cheektowaga,
  Niagara Falls, Fredonia, Perry, Olean). They share the diocesan parish finder but are
  social-service offices and publish no bulletin.
- **closed (23)** — St. Mary Queen of the Rosary (Strykersville), Our Lady of Loreto (Falconer),
  Our Lady of the Snows (Panama), St. Joseph (Fredonia), St. Rose of Lima (Forestville),
  St. Hedwig (Dunkirk), St. Patrick (Brocton), St. Isaac Jogues (Sherman), St. Mary (Batavia),
  Holy Spirit (North Collins), St. Mary (Cattaraugus), St. Jude (Sardinia), St. John the Baptist
  (West Valley), St. Thomas Aquinas (Buffalo), St. Anthony (Farnham), SS. Brendan & Jude (Almond),
  St. Joseph (Perry), St. Mary (Silver Spring), Immaculate Conception (East Bethany), Our Lady of
  Fatima (Elba), St. Joseph (Lyndonville), St. Joseph (Lockport), Immaculate Conception (Cassadaga).
  **Sixteen of them are still in the live diocesan feed**, including Lyndonville, which was
  **demolished in 2023**, and Cassadaga, whose parish the diocese's own records index closed in
  **2008** — eighteen years of lag in a single row. The rest are in the file because GCatholic, or
  the April 2026 masterlist, still files them under a current parish. Two rows are ones we had
  already modelled and took back out: St. Mary (Batavia) and St. Joseph (Lyndonville).
- ~~**St. Casimir** (Buffalo, Kaisertown, 160 Cable St) — independent/non-diocesan Polish church~~
  **— REVERSED (commit `e556743`).** The earlier call was wrong. The Diocese of Buffalo's *own*
  parish finder lists St. Casimir at 160 Cable St as a diocesan parish (founded 1891) with its own
  homepage `stcasimirbuffalo.com`, which resolves and serves parish content. Added as
  `st-casimir-buffalo`. Lesson worth keeping: prefer the diocese's own directory over third-party
  claims about jurisdiction. *(It is now a worship site of `cheektowaga-kaisertown-sloan-catholic`
  — a diocesan parish with a live site, and still not a bulletin of its own. §1 is about the
  bulletin, not about jurisdiction or hosting.)*

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

### 6f. Deferred inventory — 2 worship sites / 2 parishes, neither blocked on research

A *closed* list, not an open-ended "rest of the diocese": every worship site the diocese lists is
either in the dataset, in `data/buffalo_excluded_sites.csv` (§6d), or here.

**Regenerate it; don't read the prose as current.** The counts and groupings below are a snapshot,
the diocese edits the feed, and this section has already been wrong twice:

```
uv run python scripts/reconcile_diocese_roster.py dio.json --list -o missing.json
```

The value the tooling cannot regenerate is *why* each site is blocked, so that is what the groups
below record. They are ordered cheapest first.

**(a) Sites under a parish the masterlist names — empty *as of this session's re-diff*, and it has
been wrongly declared empty twice.** Both times the claim came from having harvested the `◦` lines
someone happened to look at, not from diffing the whole masterlist. **`reconcile_diocese_roster.py`
cannot see this class**: a `◦` site absent from both `churches.csv` and the parish finder is
invisible to the reconciler, which only measures the feed. Re-diff `fetch_diocese_family_list.py`
output against `churches.csv` yourself, every session, and after every masterlist re-issue.

**(b) Whole families whose bulletin has not been probed — EMPTY. Every family in the diocese has
now been read.** The five that were listed here went three different ways, and that spread is the
finding: Cattaraugus Creek and Lakeshore were each **one** bulletin over several standing rows
(collapsing 1 and 3 rows respectively), South Buffalo the same (collapsing 2), while Downtown
Buffalo and Blessed Family 7 share **no** bulletin at all and simply needed one more row each.
**Never assume a family's shape before reading its bulletin** — and note the two that did not
collapse are the two with the most members. Size predicts nothing either.

**(c) The last 2 feed sites. Research is finished on both; each needs a decision, not a lookup.**
Every other entry that stood here has been resolved — five became church rows, one became a parish
row, and five turned out to be closed and are now in `data/buffalo_excluded_sites.csv`. What is
left is not the same kind of thing as what was here before, so do not treat it as backlog:

- **Holy Family, Tuscarora Reservation (5180 Chew Road, Sanborn 14132)** — live, confirmed by the
  diocese's own Mass-times page, Barnabite-run, in no family. **Blocked on a schema constraint, not
  on evidence:** `parish.homepage_url` is `NOT NULL UNIQUE` and this parish has no website, no
  family site, and no bulletin — a Facebook *group* is its entire web presence, and DiscoverMass
  confirms no bulletin exists. Three ways out, none of them free: make `homepage_url` nullable
  (touches the schema and the frontend join for every diocese); use the Facebook group under the
  §6f(e) policy, which requires first confirming it actually carries announcements; or accept that
  a parish with no bulletin is out of scope for a bulletin-extraction project and record it as a
  permanent exclusion with reason `no-bulletin` rather than `closed`. **This is a maintainer
  decision.**
- **Queen of Angels, Lackawanna (144 Warsaw St)** — live now, closing "near the end of the summer"
  2026. Deliberately neither modelled nor excluded; see the §5 entry. **Re-check after Labor Day
  2026**, then write the exclusion row.

**(d) Restructures of existing rows — deliberately not done.** Needs a bulletin probe first, and it
*removes* a parish row rather than adding one:
- `enchanted-mountains-catholic` — the diocese lists St. John (Olean) and St. Mary of the Angels
  (Olean) as separate parishes with live domains, which under §1 argues for splitting our single row.

**(e) ~~Open policy question~~ — SETTLED, AND THEN MOOT.** A social page may be the `website` when
it genuinely hosts the bulletin (§2 policy 1). The parish that prompted the question — Our Lady of
Perpetual Help (Buffalo), listed by the diocese with a Facebook URL and no domain — turned out not
to need it: it shares the Catholic Family of South Buffalo bulletin, so it is a **worship site**
with no `website` of its own. The advice this entry already gave ("probe that family's bulletin
first") was the right order of operations. The policy stands for the next Facebook-only parish;
it just never got used on this one — though Holy Family (Tuscarora) in (c) may finally be the case
it was written for.

**(f) Open policy question — public Mass venues that are not parishes and not in the feed.**
Diffing the diocesan Mass-times page (§4e) against `churches.csv` surfaced **Our Lady of Fatima
Shrine, Lewiston** — Sunday Mass at 9:00 and 12:00, Barnabite-run, its own site at
`fatimashrine.com`, and **absent from the parish finder**, so the reconciler will never mention it.
It is a shrine, not a parish and not a worship site *of* a parish, so no existing row type fits.

The question is where the line goes, and it is the same line §6a drew for St. Adalbert from the
other side. There we decided **four Masses a year at a parish's own building still counts**; here
the venue has *weekly* Mass but no parish attached. If "somewhere a Catholic can go to Mass this
Sunday" is the thing this project indexes, shrines, university chapels and oratories belong in it
and the feed is the wrong denominator. If "parishes that publish bulletins" is the thing, this one
is out and so is Holy Family. **Decide it once, for both**, and note the answer changes the
coverage metric's meaning rather than its numerator: Fatima Shrine cannot be counted as missing
today because nothing counts it at all. Re-run the §4e diff after deciding — it was run once, by
hand, and shrines are exactly what it is good at finding.

### 6g. Dead end worth recording: the ParishesOnline API

Groups (c)–(d) all reduce to "find the bulletin org", so a bulk source for that was worth chasing.
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

**For the rest of Buffalo**, the earlier advice here — "every remaining site is blocked on
per-parish research, work them one at a time with `WebSearch`" — turned out to be wrong, and it was
wrong in an expensive direction. Most of those sites were not blocked on research at all. They were
blocked on *structure*, and the diocese publishes the structure. Coverage went 62% → 79% in a
single session, mostly by reading two documents the earlier passes never opened.

Work in this order, cheapest first, and only fall through when a step genuinely cannot answer:

1. **Pull the two diocese-wide pages (§4e) and diff them against `churches.csv`.** The Mass-times
   page tells you which buildings are open; the sacramental-records index tells you which parishes
   are dead and where they went. Two fetches, whole diocese, and between them they resolve most of
   what used to be per-parish research. This step is new and it goes first because everything below
   is more expensive.
2. **Read the family masterlist (§4c).** `fetch_diocese_family_list.py`. Every `◦` line under a
   parish already in `parishes.csv` is a lead for a church row, cheap because no bulletin research
   is needed — but **diff the whole masterlist against `churches.csv` rather than reading down it**,
   and check the site against step 1 before adding, because the masterlist lags on closures (§4c).
3. **Probe the family's bulletin container (§4b).** `probe_bulletin_container.py --pages 3`. This
   answers "one parish or several?" directly, and it is the *only* thing that answers it when
   members keep separate live domains. **Buffalo's families are all read now (§6f(b) is empty)**,
   so this step is for the next diocese — where the lesson to carry over is that a family predicts
   nothing: of Buffalo's last five, three were one bulletin and two were none.
   If every container in the family is dead, compare the sites' LPi `publicationWidget` ids
   instead (§4b) — same id is one bulletin, different ids are two.
4. **Only then** research a parish individually with `WebSearch`/`WebFetch`, falling back to
   `gcatholic.org` for address + Plus Code when a parish host 403s. ParishesOnline's API is a dead
   end for finding bulletins in bulk (§6g). **Buffalo has no work left at this step** — the two
   entries in §6f(c) are researched and waiting on decisions, not lookups.

Whichever step resolves it, the row-level rules are unchanged:

- Cross-check each address against a 2nd independent source before `address_verified=true`, and
  leave it `false` when sources genuinely disagree rather than picking a favourite quietly.
- Decide parish-vs-worship-site by **who publishes the bulletin** (§1) — never by domain count.
- **Geocode inline** — decode the Plus Code from gcatholic (no network needed, see
  `decode_plus_code` in `scripts/fetch_gcatholic_roster.py`), or use Nominatim, which works here.
- **Check whether the building still exists** before adding it, and check it against the diocesan
  Mass-times page (§4e), not against closure reporting. The feed lists closed churches for years —
  twenty-three closures are already in `data/buffalo_excluded_sites.csv`, one demolished and one
  suppressed in 2008 — and confirming a closure is as much progress as adding a row. But the
  converse trap is worse and St. George (West Falls) is the example: **a closed parish is not a
  closed building**, and every closure source said "closed" while the family's schedule said
  Saturday 9 am. Record exclusions with their evidence, dated from a Mass schedule where you can.
- `db create` + `pytest` after every batch, one commit per batch, and log the batch here.

Coverage is **140 of 142 real worship sites (99%)**, all 8 counties, with 2 left in §6f(c) —
Holy Family (Tuscarora), blocked on the `NOT NULL UNIQUE` website column rather than on evidence,
and Queen of Angels (Lackawanna), open now and closing at the end of summer 2026. **There is no
research backlog left in this diocese.** What remains is two maintainer decisions and one policy
question (§6f(f), non-parish Mass venues) — and a standing caution that the 99% is measured against
the parish finder, which §4e has now shown is not the diocese's only list of buildings.
