#!/usr/bin/env python
"""Diff a diocese's parish-finder roster against data/churches.csv.

Answers the only question that matters once a diocese is partly modelled:
*what is still missing, and what is each missing site's blocking reason?*
Run it after every batch instead of trusting a hand-maintained checklist — the
diocesan feed changes underneath you (parishes close, homepages lapse).

Input is the JSON written by `scripts/fetch_diocese_locator.py`.

    uv run python scripts/fetch_diocese_locator.py <parish-finder URL> -o dio.json
    uv run python scripts/reconcile_diocese_roster.py dio.json --list

Matching runs several nets, because no single one is sufficient (docs §4a):

* normalised address + city, and normalised dedication + city — the two nets
  the bulk method already relies on;
* street address *ignoring* the city, which catches the diocese spelling a
  hamlet differently from us ("Swormsville" vs "Swormville").

A dedication-only net is deliberately NOT used: with two dioceses loaded there
is a St. Mary and a St. Joseph in a dozen towns, so it matches nearly anything.

The feed also lists some sites twice — same dedication, same town, slightly
different street text — so repeats are collapsed *before* matching and reported
separately. Collapsing first matters: while repeats were only detected among the
rows that failed to match, modelling such a site made both of its feed rows
count as covered, which quietly inflated the numerator and the denominator (and
reported "repeated 0" for a feed that still contained the repeat).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
CHURCHES_CSV = DATA / "churches.csv"
EXCLUDED_CSV = DATA / "buffalo_excluded_sites.csv"

SUFFIX = {
    "ave": "avenue", "av": "avenue", "st": "street", "rd": "road", "dr": "drive",
    "blvd": "boulevard", "ln": "lane", "pkwy": "parkway", "hwy": "highway",
    "ct": "court", "pl": "place", "ter": "terrace", "cir": "circle",
    "sq": "square", "tpke": "turnpike", "rt": "route", "rte": "route",
    "n": "north", "s": "south", "e": "east", "w": "west",
    "ne": "northeast", "nw": "northwest", "se": "southeast", "sw": "southwest",
}

NOISE = re.compile(
    r"^(the\s+)?(basilica|cathedral|shrine|national shrine|co-cathedral)\s+(of\s+)?", re.I
)


def norm_addr(line1: str, city: str) -> str:
    s = (line1 or "").lower()
    s = re.sub(r"[.,#]", " ", s)
    s = re.sub(r"\b(suite|ste|apt|unit)\b.*$", "", s)
    parts = [SUFFIX.get(w, w) for w in s.split()]
    return " ".join(parts).strip() + "|" + (city or "").strip().lower()


def norm_name(name: str, city: str) -> str:
    s = NOISE.sub("", (name or "").strip()).lower()
    s = re.sub(r"\b(saint|st)\b\.?", "st", s)
    s = re.sub(r"\b(ss|sts)\b\.?", "st", s)
    s = re.sub(r"\b(roman catholic|catholic)\b", "", s)
    s = re.sub(r"\b(church|parish|rc|r c)\b", "", s)
    s = re.sub(r"\bof the\b", "", s)
    s = re.sub(r"\bof\b", "", s)
    return re.sub(r"[^a-z0-9]+", "", s) + "|" + (city or "").strip().lower()


# Two feed rows for the same dedication in the same town are the same building
# only if they also sit in the same place: the feed carries St. Mary, Mayville
# at both "24 E. Chautauqua St" and "22 East Chautauqua St, Route 430", 30 m
# apart. A city with two genuinely distinct churches of one dedication would not
# come anywhere near this.
SAME_SITE_METRES = 200


def metres_apart(a: dict, b: dict) -> float | None:
    try:
        lat1, lon1, lat2, lon2 = (float(a["latitude"]), float(a["longitude"]),
                                  float(b["latitude"]), float(b["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("roster", type=Path, help="JSON from fetch_diocese_locator.py")
    ap.add_argument("--list", action="store_true", help="print the missing sites")
    ap.add_argument("--exclude", default="",
                    help="skip canonical parishes containing this substring "
                         "(e.g. a diocese's pregnancy-center entries)")
    ap.add_argument("--exclude-file", type=Path, default=EXCLUDED_CSV,
                    help="CSV of site,city rows never to count as missing "
                         f"(default: {EXCLUDED_CSV.name}); pass a missing path to skip")
    ap.add_argument("-o", "--out", type=Path, help="write missing sites as JSON here")
    args = ap.parse_args()

    dio = json.loads(args.roster.read_text(encoding="utf-8"))
    if args.exclude:
        dio = [r for r in dio if args.exclude.lower() not in r["parish"].lower()]

    # Sites we have decided will never be modelled. Without this the "MISSING"
    # count silently overstates the work left, because a diocese keeps listing a
    # church for months or years after its last Mass. The reasons are reported
    # rather than hardcoded, so a new class of exclusion shows up here instead of
    # hiding inside a total.
    excluded: dict[tuple[str, str], str] = {}
    if args.exclude_file and args.exclude_file.exists():
        with args.exclude_file.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                key = (norm_name(row["site"], ""), row["city"].strip().lower())
                excluded[key] = (row.get("reason") or "unspecified").strip()

    def _excl(r: dict) -> str | None:
        return excluded.get((norm_name(r["site"], ""), r["city"].strip().lower()))

    dropped = [r for r in dio if _excl(r)]
    dio = [r for r in dio if not _excl(r)]

    exact_addr: dict[str, str] = {}
    exact_name: dict[str, str] = {}
    addr_nocity: dict[str, str] = {}
    with CHURCHES_CSV.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            tag = f"{row['parish_id']}/{row['slug']}"
            exact_addr[norm_addr(row["line1"], row["city"])] = tag
            exact_name[norm_name(row["name"], row["city"])] = tag
            addr_nocity.setdefault(norm_addr(row["line1"], ""), tag)

    # Collapse the feed's repeats first, so a site counts once whether or not we
    # already model it.
    dupes, feed = [], []
    seen: dict[str, dict] = {}
    for r in dio:
        key = norm_name(r["site"], r["city"])
        first = seen.get(key)
        if first is not None:
            gap = metres_apart(first, r)
            if gap is None or gap <= SAME_SITE_METRES:
                dupes.append({**r, "_dupe_of": first["site"]})
                continue
        seen.setdefault(key, r)
        feed.append(r)

    matched, loose, missing = [], [], []
    for r in feed:
        hit = (exact_addr.get(norm_addr(r["line1"], r["city"]))
               or exact_name.get(norm_name(r["site"], r["city"]))
               or exact_name.get(norm_name(r["parish"], r["city"])))
        if hit:
            matched.append({**r, "_hit": hit})
            continue
        near = addr_nocity.get(norm_addr(r["line1"], ""))
        if near:
            loose.append({**r, "_hit": near})
            continue
        missing.append(r)

    unique = len(dio) - len(dupes)
    if dropped:
        by_reason = Counter(_excl(r) for r in dropped)
        breakdown = ", ".join(f"{n} {reason}" for reason, n in sorted(by_reason.items()))
        print(f"excluded    {len(dropped)}  ({breakdown}, per {args.exclude_file.name})")
    print(f"feed rows {len(dio)}  (unique sites {unique})")
    print(f"  modelled     {len(matched) + len(loose)}"
          f"   ({len(loose)} matched only after ignoring the city spelling)")
    print(f"  repeated     {len(dupes)}")
    print(f"  MISSING      {len(missing)}"
          f"   across {len({r['parish'] for r in missing})} canonical parishes")
    if unique:
        print(f"  coverage     {(len(matched) + len(loose)) / unique:.0%}")

    for r in loose:
        print(f"  [city-spelling] {r['site']} ({r['line1']}, {r['city']}) -> {r['_hit']}")
    for r in dupes:
        print(f"  [feed repeat]   {r['site']} ({r['line1']}, {r['city']})")

    if args.list:
        by: dict[str, list] = {}
        for r in missing:
            by.setdefault(r["parish"], []).append(r)
        print()
        for parish in sorted(by):
            rows = by[parish]
            web = sorted({r["website"] for r in rows if r["website"]})
            print(f"- {parish}  [{len(rows)} site(s)]  web={web or '(none listed)'}")
            for r in rows:
                print(f"    {r['site']} | {r['line1']}, {r['city']} {r['zip']}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(missing, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
