# Diocese of Buffalo expansion — continuation log

This is the **continuation record** for the Buffalo expansion, kept separate from the
cloud agent's `buffalo-expansion-scratchbook.md`. The cloud agent ran in a sandbox that
blocked direct HTTP (`curl`/`WebFetch` → 403) and Nominatim, so it left every new church
with **blank coordinates** and several addresses unverified, handing those off to the
pipeline. This environment has **working WebFetch and Nominatim**, so this log records the
follow-up work that closes those gaps and extends the dataset.

Conventions inherited from the scratchbook (slug uniqueness, parish-vs-worship-site by
who-publishes-the-bulletin, `state=NY`, per-batch commits) still apply.

---

## Session 1 (2026-06-23) — Geocoding backfill

**What I could do that the cloud agent couldn't:** direct HTTP works here. Verified both
`WebFetch` and a raw Python `urlopen` to `nominatim.openstreetmap.org` succeed, and
`uv run python -m pdf_extract geocode run` reaches Nominatim.

**Result: all 38 Buffalo churches now carry coordinates** (previously 0/38). They will now
render on the map without waiting for a pipeline geocode run.

Method:
1. Geocoded every blank-coord church (`latitude`/`longitude` empty) via Nominatim, trying
   free-form → structured → name+city queries. 37/43 resolved on the first pass.
2. For the 6 that Nominatim couldn't pin, pulled the **Plus Code (Open Location Code)** from
   each church's `gcatholic.org` page and decoded it with the canonical OLC algorithm, then
   **reverse-geocoded the result to confirm** it lands on the right street/town:
   - `st-gregory-the-great-williamsville` → 42.9933125, -78.7279375
     (reverse-geocode: "Saint Gregory the Great, 200 Saint Gregory Court" — exact hit)
   - `st-john-baptist-kenmore` → 42.9741875, -78.8550625 (Englewood Ave, 14223 — Nominatim's
     free-form match had landed on the wrong end of Englewood Ave, so the Plus Code is better)
   - `st-mary-assumption-lancaster` → 42.9051070, -78.6797070 (Nominatim hit once the address
     was normalized "St." → "Saint")

**Out-of-scope bonus / notes (pre-existing Rochester rows, blank before this branch):**
- `sacred-heart-of-jesus` (Perkinsville) geocoded via Plus Code → 42.5406875, -77.6273125.
  **Address discrepancy found:** CSV has `11114 Chapel Street`; gcatholic + Yelp +
  catholicchurch.directory all say **11119 Chapel St**. Left the address as-is (not my
  branch's data) but flagged for a future fix.
- `st-marys-rexville` and `st-patrick-savannah` still blank — Nominatim has no match for
  their rural addresses and I didn't want to touch out-of-scope Rochester address data.
  `st-patrick-savannah` also shows an address conflict (CSV `52 Clyde Street` vs. directory
  listings showing `1583 Grand Ave, Savannah 13146`). Left for the Rochester data owner.

Build/test after backfill: `db create` → 90 parishes / 170 churches; `pytest` → 117 passed.

---

## Session 1 (cont.) — Verifying the `address_verified=false` rows

The cloud agent left 5 Buffalo churches with `address_verified=false` for the verify stage.
Resolved 4 of them against authoritative sources (cross-checked, then flipped to `true`):

| church | confirmed address | source |
|---|---|---|
| `st-francis-of-assisi-tonawanda` | 71 Adam St | parish's own site rcct.faith (it's now chapel-only — last Mass in the main church Apr 2025 — but still active for funerals/columbarium services) |
| `sacred-heart-portville` | 43 Maple Ave | gcatholic (now titled "Oratory of the Sacred Heart") |
| `resurrection-cheektowaga` | 130 Como Park Blvd | official cheektowagacatholicfamily.org |
| `queen-of-martyrs-cheektowaga` | 180 George Urban Blvd | official cheektowagacatholicfamily.org |

**`immaculate-conception-wellsville` — house number left disputed on purpose.** Sources
split: parish site (icc-ics.com, per scratchbook) says church = **36 Maple Ave**; gcatholic,
Yelp, and catholicchurch.directory say **6 Maple Ave** (office = 17). I geocoded all three
house numbers plus the OSM `place_of_worship` node named "Immaculate Conception Roman
Catholic Church" (42.1213889, -77.9425000). The church node sits **closest to 36 Maple
(~48 m)**, vs ~73 m to 17 and ~85 m to 6 — which corroborates 36 over 6. So I **pinned the
map coordinate to the church node** (most accurate regardless of street-number dispute) and
kept the address line "36 Maple Avenue", but **left `address_verified=false`** because three
reputable directories still disagree on the number. A human should confirm 6-vs-36 on site.

Note `icc-ics.com` and `emcatholic.org` return **HTTP 403 to WebFetch** (some parish hosts
block it), so gcatholic.org is the reliable independent channel here — it serves addresses
and Plus Codes and never 403'd.

After this: `db create` → 90 parishes / 170 churches; `pytest` → 117 passed. Net unverified
Buffalo addresses: 5 → 1 (the intentional Wellsville house-number flag).

---

## Session 1 (cont.) — Batch 7: 4 independent Buffalo-area parishes (4 churches)

`db create` 90→94 parishes, 170→174 churches; 117 tests pass. All four are **single-church
parishes with their own website and their own bulletin** (the cloud agent's "own site → own
parish" rule), fully geocoded here (no pipeline handoff needed). Picked because each is
unambiguous — no shared-domain modeling risk.

| parish slug | church — address | website | provider | coordinate source |
|---|---|---|---|---|
| blessed-trinity-buffalo | Blessed Trinity — 317 Leroy Ave, Buffalo 14214 | blessedtrinitybuffalo.org | (detect) | Nominatim house; addr via Yelp + Library of Congress (NRHP Lombard-Romanesque, 1928) |
| st-louis-buffalo | St. Louis — 35 Edward St, Buffalo 14202 | stlouisrcchurch.org | (detect) | Nominatim `place_of_worship` (exact); the diocese's oldest parish / "Mother Church" (1829) |
| st-bernadette-orchard-park | St. Bernadette — 5930 South Abbott Rd, Orchard Park 14127 | saintbopny.org | parishes_online (st-bernadette-catholic-church-14127) | Nominatim house; **street corrected** South Park→South **Abbott** Rd |
| st-rose-of-lima-buffalo | St. Rose of Lima — 500 Parker Ave, Buffalo 14216 | saintrosebuffalo.com | parishes_online (st-rose-of-lima) | Nominatim `place_of_worship` (exact) |

Slug discipline: existing Rochester `st-louis` (Pittsford) and `st-rose` (Lima) forced
city-suffixing → `st-louis-buffalo`, `st-rose-of-lima-buffalo`. All set `address_verified=true`
(each corroborated by ≥2 independent sources or an OSM church node).

### Deferred families — investigated, still deferred (with findings)

I used WebFetch to map two of the cloud agent's deferred shared-domain families, but they
stay deferred because the blocker is **canonical-parish structure**, not data I can fetch —
modeling them wrong is worse than waiting:

- **Niagara Falls RC Family of Parishes** (nfrcfparish.org). Fetched the family site; its
  worship sites are Prince of Peace (1055 Military Rd, 14304), St. Leo's (2748 Military Rd,
  14304), St. John de LaSalle (8477 Buffalo Ave, 14304), St. Mary of the Cataract (237 4th
  St, 14303), St. Joseph's (addr not listed), and Holy Family (1413 Pine Ave, 14301). These
  span **multiple canonical parishes** (e.g. Divine Mercy vs. St. Mary of the Cataract vs.
  Holy Family) under **one shared domain** — which collides with the UNIQUE-website
  constraint unless each canonical parish's own homepage/bulletin is pinned down first.
  Addresses are now captured here so a future batch only needs the parish→site split.
- **ONE Catholic** (onecatholic.org), Orleans + E. Niagara: confirmed Holy Trinity (Medina)
  worships at St. Mary, **211 Eagle St, Medina 14103**, and St. Mark (Kendall) pairs with
  St. Mary (Holley) — but all run under the shared onecatholic.org domain (Holy Family/Albion
  in batch 6 only broke out because it kept holyfamilyalbion.com). Same shared-domain blocker.

**WebFetch host blocklist observed:** `icc-ics.com`, `emcatholic.org` return HTTP 403 to
WebFetch; `nfrcfparish.org`, `cheektowagacatholicfamily.org`, `blessedtrinitybuffalo.org`,
and `gcatholic.org` all work. gcatholic is the reliable fallback (address + Plus Code).

---

## Session 1 (cont.) — Batch 8: 2 more independent parishes (2 churches)

`db create` 94→96 parishes, 174→176 churches; 117 tests pass.

| parish slug | church — address | website | provider | coords |
|---|---|---|---|---|
| corpus-christi-buffalo | Corpus Christi — 199 Clark St, Buffalo 14212 | corpuschristibuffalo.org | (detect) | 42.8918970, -78.8360600 (Nominatim house) — historic Polish parish, run by the Pauline Fathers |
| st-stephen-grand-island | St. Stephen — 2100 Baseline Rd, Grand Island 14072 | ststephenswny.com | (detect) | 43.0181085, -78.9669596 (Nominatim church node) — **first Grand Island parish** in the dataset |

Slugs city-suffixed to dodge existing Rochester `corpus-christi` (Rochester) and `st-stephen`
(Geneva) church slugs.

**Investigated but deliberately NOT added (with reasons):**
- **St. Casimir (Buffalo, Kaisertown, 160 Cable St)** — multiple sources state it is **not
  associated with the Diocese** (an independent/non-diocesan Polish church). Project Carlo
  tracks Diocese of Buffalo parishes, so it's **out of scope**. Skipped.
- **St. John Kanty (Buffalo, 101 Swinburne St)** — **closed**: final Mass May 2025, Vatican
  suspended the closure pending a 90-day appeal. In active closure flux → deferred (same call
  the cloud agent made for All Saints/Lockport and the Jamestown family).
- **St. Peter (Lewiston, 620 Center St)** — its own domain `stpeterlewiston.org`
  **301-redirects to the shared `niagarafrontiercatholic.org`** (St. Peter/Lewiston +
  St. Bernard/Youngstown + Immaculate Conception/Ransomville). Shared-domain blocker → deferred.

## Running totals (continuation)

- Cloud agent left: **28 Buffalo parishes / 38 churches, 0 with coordinates**, 5 addresses
  unverified.
- After this session: **34 Buffalo parishes / 44 churches** (added Blessed Trinity, St. Louis,
  St. Bernadette, St. Rose of Lima, Corpus Christi, St. Stephen), **all 44 geocoded**, only the
  intentional Wellsville house-number flag left unverified. Dataset overall: 96 parishes /
  176 churches; 117 tests green every step.
- **Cleanest remaining work** (data captured above, blocked on canonical-parish split, not on
  fetching): Niagara Falls family, ONE Catholic (Medina/Holley/Kendall), The Lord's Vineyard
  (Fredonia), Fields of Grace, Niagara Frontier (Lewiston/Youngstown/Ransomville). Each needs
  the per-canonical-parish homepage/bulletin confirmed before the shared domain can be split
  without violating the UNIQUE-website constraint.
