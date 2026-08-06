#!/usr/bin/env python
"""Scrape a diocese's full church roster from GCatholic into a JSON file.

GCatholic publishes, per diocese, a churches-by-city index and one detail page
per church carrying the street address, an Open Location Code (Plus Code), a
phone number, a website, and — in the index — the *canonical parish* a church
belongs to when the church's own dedication differs from its parish's name.
That is nearly everything `data/churches.csv` needs, from one source, in bulk.

Coordinates come from decoding the Plus Code locally, so no geocoder is called.

Usage:
    uv run python scripts/fetch_gcatholic_roster.py buff0 -o scratch/buffalo.json
    uv run python scripts/fetch_gcatholic_roster.py roch0 --limit 5

The diocese key is the GCatholic id ("buff0" = Buffalo, "roch0" = Rochester),
visible in the URL gcatholic.org/dioceses/diocese/<key>.htm.

Output is a JSON list of records; `parish` is GCatholic's canonical parish name
(empty when the church *is* its own parish), and `kind` distinguishes Church /
Oratory / Chapel / Mission, which matters because oratories and chapels are not
separate bulletin-publishing parishes.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import socket
import ssl
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://gcatholic.org"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) project-carlo-roster/1.0"

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

# Open Location Code ("Plus Code") decoding — enough to recover a point.
_OLC_ALPHABET = "23456789CFGHJMPQRVWX"
_OLC_PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125]


def decode_plus_code(code: str) -> tuple[float, float] | None:
    """Decode a full Open Location Code to (latitude, longitude) at its centre.

    Returns None for short/relative codes (those need a reference location).
    """
    code = code.strip().upper()
    if "+" not in code or code.startswith("+"):
        return None
    if code.index("+") != 8:  # short code — not resolvable without a locality
        return None
    clean = code.replace("+", "").rstrip("0")
    if any(c not in _OLC_ALPHABET for c in clean):
        return None

    lat, lng = -90.0, -180.0
    lat_res, lng_res = 400.0, 400.0
    i = 0
    # Pair section: characters encode latitude and longitude alternately.
    while i < len(clean) and i < 10:
        lat_res /= 20.0
        lng_res /= 20.0
        lat += lat_res * _OLC_ALPHABET.index(clean[i])
        if i + 1 < len(clean):
            lng += lng_res * _OLC_ALPHABET.index(clean[i + 1])
        i += 2
    # Grid refinement section: each character is a 4x5 subdivision.
    if len(clean) > 10:
        lat_res_g, lng_res_g = lat_res, lng_res
        for c in clean[10:]:
            idx = _OLC_ALPHABET.index(c)
            row, col = divmod(idx, 4)
            lat_res_g /= 5.0
            lng_res_g /= 4.0
            lat += row * lat_res_g
            lng += col * lng_res_g
        lat_res, lng_res = lat_res_g, lng_res_g
    return (round(lat + lat_res / 2, 7), round(lng + lng_res / 2, 7))


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": UA})
            with urlopen(req, timeout=25, context=_CTX) as resp:
                return resp.read().decode("utf-8", "ignore")
        except (HTTPError, URLError, OSError) as exc:  # transient; back off
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def _text(fragment: str) -> str:
    fragment = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", fragment, flags=re.S | re.I)
    fragment = re.sub(r"<br\s*/?>", " ~ ", fragment, flags=re.I)
    return re.sub(r"[ \t]+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def parse_index(page: str) -> list[dict]:
    """Pull (city, church id, display name, full title, parish) from the index."""
    out = []
    for row in re.findall(r"<tr[^>]*>.*?</tr>", page, flags=re.S | re.I):
        cid = re.search(r'href="\.\./([a-z0-9-]+)/(\d+)"', row)
        name = re.search(r'class="chw"[^>]*>(.*?)</a>', row, flags=re.S)
        city = re.search(r'class="znote"[^>]*>(.*?)</span>', row, flags=re.S)
        title = re.search(r'title="([^"]+)"', row)
        if not (cid and name and city):
            continue
        # The index shows "St. Joseph ~ Resurrection Parish" when the church's
        # dedication differs from the parish it now belongs to.
        cell = _text(name.group(1))
        parish = ""
        full = _text(row.split("</td>")[1] if "</td>" in row else row)
        if "~" in full:
            tail = full.split("~", 1)[1].strip()
            if tail.lower().endswith("parish") or " parish" in tail.lower():
                parish = tail
        out.append({
            "path": f"{cid.group(1)}/{cid.group(2)}",
            "gcatholic_id": cid.group(2),
            "index_city": _text(city.group(1)),
            "name": cell,
            "title": html.unescape(title.group(1)) if title else cell,
            "parish": parish,
        })
    return out


def parse_detail(page: str) -> dict:
    body = _text(page)
    rec: dict = {}
    addr = re.search(r"Address:\s*(.*?)(?:Country:|Telephone:|Website:|GCatholic Church ID)", body)
    if addr:
        rec["address_raw"] = addr.group(1).strip().rstrip(",")
    loc = re.search(r"Location:\s*([0-9A-Z]{4,8}\+[0-9A-Z]{2,3})", body)
    if loc:
        rec["plus_code"] = loc.group(1)
        coords = decode_plus_code(loc.group(1))
        if coords:
            rec["latitude"], rec["longitude"] = coords
    tel = re.search(r"Telephone:\s*(\+1 \([0-9]{3}\) [0-9]{3}-[0-9]{4})", body)
    if tel:
        rec["phone"] = tel.group(1)
    hist = re.search(r"History:\s*(\d{4})", body)
    if hist:
        rec["founded"] = hist.group(1)
    kind = re.search(r"Type:\s*([A-Za-z ()]+?)(?:Rite:|List:|History:|Location:)", body)
    if kind:
        rec["kind"] = kind.group(1).strip()
    sites = [h for h in re.findall(r'href="(https?://[^"]+)"', page)
             if "gcatholic" not in h and "jsdelivr" not in h and "googleapis" not in h
             and "facebook" not in h and "x.com" not in h and "youtube" not in h]
    if sites:
        rec["website"] = sites[0]
    return rec


def parse_address(raw: str) -> dict:
    """Split GCatholic's 'street, City, State ZIP-4' into structured parts."""
    out = {"line1": "", "city": "", "state": "", "postal_code": ""}
    if not raw:
        return out
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if parts and parts[-1].upper() == "USA":
        parts.pop()
    if parts:
        tail = parts[-1]
        m = re.search(r"^(.*?)\s+(\d{5})(?:-\d{4})?$", tail)
        if m:
            out["state"] = m.group(1).strip()
            out["postal_code"] = m.group(2)
            parts.pop()
        if parts:
            out["city"] = parts.pop()
    out["line1"] = ", ".join(parts).rstrip(".")
    if out["state"].lower() in ("new york", "ny"):
        out["state"] = "NY"
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("diocese", help="GCatholic diocese key, e.g. buff0")
    ap.add_argument("-o", "--out", type=Path, help="write JSON here (default stdout)")
    ap.add_argument("--limit", type=int, help="only fetch N detail pages (smoke test)")
    ap.add_argument("--workers", type=int, default=6, help="parallel fetches (default 6)")
    args = ap.parse_args()

    socket.setdefaulttimeout(30)
    index = parse_index(fetch(f"{BASE}/churches/local/{args.diocese}"))
    if args.limit:
        index = index[: args.limit]
    print(f"index: {len(index)} churches", file=sys.stderr)

    def enrich(rec: dict) -> dict:
        try:
            detail = parse_detail(fetch(f"{BASE}/churches/{rec['path']}"))
        except RuntimeError as exc:
            print(f"  !! {rec['name']} ({rec['city']}): {exc}", file=sys.stderr)
            return rec
        rec.update(detail)
        parsed = parse_address(rec.get("address_raw", ""))
        # The detail page's city is the postal one; fall back to the index's.
        parsed["city"] = parsed["city"] or rec["index_city"]
        parsed["state"] = parsed["state"] or "NY"
        rec.update(parsed)
        return rec

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        records = list(ex.map(enrich, index))

    got = sum(1 for r in records if r.get("latitude"))
    print(f"detail: {got}/{len(records)} with coordinates", file=sys.stderr)

    payload = json.dumps(records, indent=2, ensure_ascii=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
