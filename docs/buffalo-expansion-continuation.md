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
