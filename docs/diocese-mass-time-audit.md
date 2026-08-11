# Diocese listing vs. bulletin-extracted Mass times

**Audit date:** 2026-08-11
**Diocese source:** Diocese of Rochester parish/Mass-time listing (transcribed to `data/diocese_mass_times.csv`)
**Project source:** `data/events.json` — weekly, non-cancelled `mass` events, one bulletin per parish
**Reproduce:** `python src/pdf_extract/audit_diocese.py`

## Summary

| | Count |
|---|---|
| Diocese listing rows | 158 |
| Rows mapped to a `churches.csv` slug | 132 (129 distinct churches) |
| Rows with no counterpart in the project | 26 |
| Churches audited | 130 |
| **Exact match** (all listed times agree) | **78** |
| **Mismatch** | **39** |
| Diocese-listed, no bulletin data extracted | 10 |
| Bulletin data extracted, not listed by the diocese | 3 |

Two comparison rules keep the diff honest:

- **Weekday scope.** Most diocese entries publish weekend times only. Where a diocese entry lists no weekday Masses at all, weekday Masses found in the bulletin are *not* counted as discrepancies — the listing simply doesn't cover them. Where the diocese *does* list weekdays, they are compared in full.
- **One bulletin per parish.** Each church's times come from a single, most-recent bulletin. Bulletin recency varies (see [Stale bulletins](#stale-bulletins)); a summer bulletin will legitimately omit Masses that resume in September.

---

## 1. Weekend Mass-time conflicts — both sources list a Mass, at different times

These are the highest-impact discrepancies: someone following the diocese page arrives at the wrong time.

| Church | Diocese | Bulletin | Delta |
|---|---|---|---|
| St. Charles Borromeo, Greece (#32) | Sat 4:30 PM | Sat 4:00 PM | −30 min |
| St. Leo the Great, Hilton (#259) | Sat 5:00 PM | Sat 4:00 PM | −60 min |
| St. Stanislaus Kostka, Rochester (#53) | Sun 11:15 AM | Sun 10:30 AM | −45 min |
| St. Alphonsus, Auburn (#207) | Sun 10:15 AM | Sun 10:30 AM | +15 min |
| St. Paul of the Cross, Honeoye Falls (#261) | Sun 10:00 AM | Sun 9:45 AM | −15 min |
| St. Bridget, East Bloomfield (#365) | Sun 9:30 AM | Sun 10:30 AM | +60 min |
| St. Mary, Rexville (#341) | Sun 8:30 AM | Sun 8:45 AM | +15 min |
| St. Ann, Hornell (#341) | Sun 7:00 AM, 10:30 AM | Sun 6:45 AM, 10:45 AM | −15 / +15 min |
| St. Gabriel, Hammondsport (#361) | Sun 8:00 AM | Sun 8:30 AM | +30 min |
| St. Mary, Bath (#361) | Sun 10:00 AM | Sun 10:30 AM | +30 min |
| St. Stanislaus B&M, Bradford (#355) | Sun 11:00 AM; Fri 5:30 PM | Sun 11:30 AM; Fri 4:30 PM | +30 / −60 min |
| St. Mary, Canandaigua (#365) | Sat 5:00 PM; Sun 11:30 AM | Sat 5:30 PM; Sun 12:00 PM | +30 / +30 min |
| St. Mary, Auburn (#210) | Sun 9:45 AM, 12:00 PM | Sun 10:45 AM (only) | consolidated |
| St. Patrick, Aurora (#337) | Sun 12:00 PM | Sun 9:00 AM | −3 hrs |
| St. Francis of Assisi, Auburn (#363) | Sun 10:00 AM (May–Oct) | Sun 8:45 AM | −75 min |
| Sacred Heart, Auburn (#205) | Sat 5:30 PM; Sun 7:30 AM | Sat 4:00 PM; Sun 8:30 AM | see §4 |
| St. Mary, Elmira (#370) | Sun 11:30 AM | Sun 9:00 AM | see §4 |
| St. Patrick, Elmira (#370) | Sun 10:30 AM, 5:00 PM | Sun 7:30 AM, 10:30 AM | see §4 |

## 2. Diocese lists a Mass the bulletin doesn't show

| Church | Missing from bulletin | Read |
|---|---|---|
| St. Anthony, Groton (#255) | Sun 2:00 PM | Bulletin has only Sat 4:30 PM + weekday Masses. Bulletin is from 7/12 — verify. |
| St. Catherine of Siena, Addison (#355) | Sat 6:00 PM | Bulletin has Sun 9 AM + Tue 9 AM only. |
| St. Catherine of Siena, Ithaca (#267) | Sun 11:30 AM | Bulletin is 7/19 — plausibly a summer suspension. |
| St. Hyacinth, Auburn (#363) | Sun 8:00 AM | See §4 — likely paired with St. Francis of Assisi's 8:45 AM. |
| St. Boniface, Rochester (#29) | Sat 4:30 PM | **Not an error.** Diocese notes the vigil rotates: St. Boniface Jan–Jul, St. Mary Jul–Dec. The 7/19 bulletin correctly shows the vigil at St. Mary. |
| St. Vincent de Paul, Churchville (#369) | Mon 8:30 AM | Weekday only. |
| St. Januarius, Naples (#359) | Fri 8:00 AM | Weekday only. |
| St. Michael, Penn Yan (#359) | Fri 8:00 AM | Weekday only. |
| St. Mary, Dansville (#342) | Tue 8:15 AM (bulletin: Tue 12:00 PM) | Weekday time shift. |
| All Saints, Corning (#338) | Mon/Wed/Fri 12:15 PM, Tue 8:20 AM, Sat 9:00 AM | Weekday extraction gap — the same bulletin *does* carry dated 12:15 PM and 8:00 AM Masses as one-off entries, so the recurring pattern was missed. Weekend times agree. |

## 3. Bulletin shows a weekend Mass the diocese doesn't list

| Church | Extra in bulletin | Read |
|---|---|---|
| **St. Matthew, Livonia (#339)** | **Sun 10:30 AM, Sat 4:30 PM** | Diocese lists only Mon/Wed 9 AM — the entire weekend schedule is absent from the listing. |
| **St. Mary, Honeoye (#260)** | **Sun 8:30 AM** | Diocese lists only Tue/Thu 9 AM. |
| **St. John the Evangelist, Newark Valley (#340)** | **Sun 11:15 AM** (+ Wed/Fri 8:30 AM) | Diocese says "No Mass". |
| **St. Margaret Mary, Apalachin (#340)** | **Sun 10:45 AM** (+ Tue/Thu 7 AM) | Diocese says "No Mass". |
| **St. Juan Diego Community, Leicester** | **Sat 7:00 PM** (+ Thu 8 AM) | Not in the diocese listing at all. (The listing has a Leicester "St. Thomas Aquinas, Sat 4pm at St. Lucy's" under *Individual*.) |
| Church of the Epiphany, Sodus (#353) | Sun 8:30 AM | See §4 — 8:30 AM is also St. Anne's Palmyra and St. Mary of the Lake Ontario's time. |
| St. James, Waverly (#340) | Sun 9:00 AM | See §4 — St. Patrick Owego also has Sun 9:00 AM. |
| St. Jude / Parish of the Holy Family, Gates (#367) | Sun 8:00 AM | Diocese lists Sun 9 AM, 11:30 AM, 5 PM; bulletin adds an 8 AM. Diocese's Sat 8 AM is absent from the bulletin. |

**Saturday-morning daily Masses** appear in bulletins for Our Mother of Sorrows (8 AM), St. Stephen Geneva (8 AM), St. John of Rochester (8:30 AM), St. Patrick Victor (9 AM) and St. Stanislaus Kostka (8 AM). These are daily Masses that fall on Saturday, not anticipated-Sunday vigils; the diocese listing omits daily Masses for these parishes, so this is a scope difference rather than an error.

## 4. Likely mis-attribution inside multi-church parishes

The extractor assigns events to a church slug. When a parish's bulletin covers worship sites that are **not** in `churches.csv`, those Masses have nowhere correct to land and appear to attach to a sibling church. Every case below shows that signature and should be verified against the source PDF before trusting either side.

**Most Holy Name of Jesus, Elmira (#370)** — the diocese lists six churches; `churches.csv` has two (plus an adoration chapel). Three listed Mass sites (Our Lady of Lourdes Sun 9 AM, Ss. Peter and Paul Sat 5:30 PM, St. Casimir Sun 7:30 AM) have no slug. The bulletin then reports **Sun 9:00 AM at St. Mary's** (Our Lady of Lourdes' listed time) and **Sun 7:30 AM at St. Patrick's** (St. Casimir's listed time), while the diocese's St. Mary 11:30 AM and St. Patrick 5:00 PM appear nowhere. This reads as three churches' schedules collapsed into two slugs.

**Sacred Heart / St. Alphonsus / St. Ann / Holy Family, Auburn (#204, #205, #207)** — Holy Family Church (85 North St, Sat 4 PM / Sun 9 AM per the diocese) is in `churches.csv` but has **no** extracted events, while the bulletin gives Sacred Heart a **Sat 4:00 PM** the diocese doesn't list. Separately, the diocese's Sacred Heart row (Sat 5:30 PM, Sun 7:30 AM) duplicates St. Mary Auburn's listed Sat 5:30 PM / Sun 7:00 AM almost exactly — so the *diocese* row may be the copied one. Both sides need checking here; do not assume the bulletin is wrong.

**Ss. Mary and Martha, Auburn (#363)** — the two churches alternate seasonally (May–Oct: St. Francis Sun 10 AM, St. Hyacinth Sat 4 PM + Sun 8 AM). The bulletin gives St. Hyacinth Sat 4:00 PM ✓ but puts the Sunday morning Mass at **St. Francis 8:45 AM** rather than St. Hyacinth 8:00 AM. Either the season flipped, the time moved, or the site attribution is off by one church.

**Church of the Epiphany, Sodus (#353)** — bulletin adds Sun 8:30 AM, which is exactly the listed Sunday time for both sibling churches (St. Anne's Palmyra, St. Mary of the Lake Ontario). Note the extraction sourced Epiphany's 10:30 AM from page 1 and the 8:30 AM from page 3, i.e. from a different part of the schedule block.

**St. James, Waverly (#340)** — bulletin adds Sun 9:00 AM, the same time the bulletin also assigns to St. Patrick Owego in the same parish.

## 5. Coverage gaps — diocese lists Masses, project has no data

Ten churches exist in `churches.csv` but produced no Mass events:

| Church | Diocese times | Cause |
|---|---|---|
| Holy Apostles, Rochester (#7) | Sat 4 PM; Sun 9:30 AM, 11:30 AM | No bulletin source — `detect_other_parishes.csv` notes "can't find bulletin" |
| Our Lady of Victory / St. Joseph, Rochester (#22) | Sat 4:30 PM; Sun 10 AM | No parish bulletin configured |
| Annunciation, Rochester (#358) | Sat 4:15 PM; Sun 10:15 AM | St. Frances Xavier Cabrini has no bulletin configured |
| Corpus Christi / Our Lady of the Americas (#358) | Sun 8:45 AM, 10:45 AM | same |
| St. Michael, Rochester (#358) | Sun 11:45 AM, 4 PM | same |
| St. Thomas the Apostle / Latin Mass Community (#357) | Sun 9 AM, 11:15 AM | Separate community (skt-lmc.org); not in the St. Kateri bulletin |
| Holy Family, Auburn (#204) | Sat 4 PM; Sun 9 AM | See §4 |
| St. Pius V, Cohocton (#342) | Sun 11 AM | Parish bulletin extracted, this site produced nothing |
| St. Thomas, Red Creek (#345) | Sun 8 AM (mid-Sept–mid-June) | **Expected** — out of season in August |
| St. Patrick, Savannah (#364) | Sacraments only | **Expected** — no Masses listed |

Twenty-six diocese rows have no `churches.csv` counterpart at all. Those with real Mass times:

- **Parish churches:** St. George R.C. Lithuanian, Rochester (Sun 9:30 AM, 11 AM Lithuanian) · St. John, Port Byron (Sat 5 PM) · St. Joseph, Rush (Sun/Tue/Thu 8 AM) · Mission of Our Lady of Guadalupe, Marion (Sun 2 PM Spanish) · Our Lady of Lourdes, Elmira (Sun 9 AM) · Ss. Peter and Paul, Elmira (Sat 5:30 PM) · St. Casimir, Elmira (Sun 7:30 AM)
- **Individual / non-parish:** Abbey of the Genesee · Carmelite Monastery Pittsford · Mount Saviour Monastery · Newman Centers (Brockport, Cornell, U of R, RIT, Geneseo) · Ss. Peter and Paul Auburn · St. Alban's · St. Ann Community · St. Bernard Scipio Center · St. Josaphat's (Ukrainian) · St. Nicholas Elmira Heights · St. Nicholas the Wonderworker · St. Thomas Aquinas Leicester · Ukrainian Catholic Church of Epiphany

## 6. Errors in the diocese listing itself

- **St. Rose, Lima (#270)** — address reads *130 Beach 84th St, Lima, NY 11230*, county *Kings*. That ZIP, street and county are Brooklyn, not Livingston County. `churches.csv` has 1985 Lake Avenue, Lima, NY 14485.
- **St. Anne (#26)** — Sunday 11 AM is annotated "(starting Nov. 6)". That transition is long past; the note is stale.
- **St. Mary, Bath (#361)** — the times cell duplicates a fragment: "After Labor Day, Sat: 4pm After Labor Day, Sat: 4pm".
- **St. James the Apostle (#368)** — listed twice, once under Interlaken and once under Trumansburg, both Sun 9 AM. `churches.csv` places it in Trumansburg; the Interlaken row appears to be a duplicate.
- **St. Lucy (#344)** — diocese files it under Retsof; `churches.csv` has 2770 Retsof Avenue, **Piffard** NY 14533. Locality-label disagreement rather than a clear error, but the two should be reconciled so the church resolves consistently in search.
- **Holy Spirit (#294)** — diocese says Penfield; `churches.csv` says Webster (1355 Hatch Rd is on the line).
- **St. Ann (#290)** — diocese says Owasco; `churches.csv` says Auburn.
- **St. Charles Borromeo (#32)** — location column says Rochester, address says Greece. Same pattern on St. Pius the Tenth (#51), St. Theodore (#54) and others where the location column and address disagree.
- **Nativity / St. Elizabeth Ann Seton (#215, #335)** — both rows repeat the full four-Mass parish schedule verbatim, so each church appears to host all four. The bulletin correctly splits them (Nativity: Sat 5 PM, Sun 11 AM, Sun 1:30 PM Spanish; SEAS: Sun 9 AM).

## Stale bulletins

Times below are only as current as the bulletin they came from. Twelve parishes are running on a bulletin older than two weeks:

| Parish | Bulletin date | Affected churches |
|---|---|---|
| st-monica-emmanuel | 2026-03-22 (fetched; no published date) | St. Monica, Emmanuel Church of the Deaf |
| immaculate-conception-st-bridgets | 2026-05-24 | Immaculate Conception / St. Bridget's, Rochester |
| st-jerome | 2026-07-05 | St. Jerome |
| net-catholic | 2026-07-12 | All Saints Lansing, Holy Cross Freeville, St. Anthony Groton |
| st-benedict-parish | 2026-07-12 | St. Bridget's Bloomfield, St. Mary's Canandaigua |
| st-john-of-rochester | 2026-07-12 | St. John of Rochester |
| assumption-resurrection | 2026-07-19 | Assumption, Resurrection |
| our-lady-queen-of-peace-st-thomas-more | 2026-07-19 | OLQP, St. Thomas More |
| southeast-rochester-catholic-community | 2026-07-19 | Blessed Sacrament, St. Boniface, St. Mary's |
| st-catherine-of-siena-ithaca | 2026-07-19 | St. Catherine of Siena Ithaca |
| parish-of-the-holy-family | 2026-07-26 | Parish of the Holy Family, Gates |
| st-lawrence | 2026-07-26 | St. Lawrence |

Three §1/§2 findings sit on stale bulletins and should be re-checked after a fresh fetch before being treated as real conflicts: **St. Bridget's Bloomfield**, **St. Mary's Canandaigua** (both 7/12) and **St. Catherine of Siena Ithaca** (7/19). **St. Anthony Groton**'s missing Sun 2 PM is on a 7/12 bulletin.

## Suggested follow-ups

1. Verify the §4 attribution cases against the source PDFs — they are the only findings where the *project's* data is likely wrong rather than the diocese's.
2. Add the missing worship sites to `churches.csv` (the six Elmira churches, Holy Family Auburn's siblings, St. Joseph Rush, St. John Port Byron, Marion's Guadalupe mission). Partial parish coverage is what drives the mis-attribution.
3. Re-fetch the twelve stale parishes, then re-run this audit to clear the seasonal/stale noise.
4. Report to the diocese: the two "No Mass" churches that have Sunday Masses (#340 Newark Valley, Apalachin), the two churches whose weekend schedules are missing entirely (#339 St. Matthew, #260 St. Mary Honeoye), and the St. Rose Lima address.
