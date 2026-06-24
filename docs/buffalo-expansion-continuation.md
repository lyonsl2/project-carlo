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
