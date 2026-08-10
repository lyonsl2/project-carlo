#!/usr/bin/env python
"""Pull a diocese's parish list from a WP Store Locator powered parish finder.

Many diocesan sites run WordPress with the "WP Store Locator" plugin for their
parish finder. The plugin exposes an unauthenticated `store_search` AJAX action
that returns every location as JSON — name, street, city, state, zip, phone,
coordinates and homepage — in a single request. That is the authoritative
parish list straight from the diocese, and it is the right backbone for
`data/parishes.csv` because it also encodes the parish/worship-site structure
in the location name, e.g.

    "St. Mary of Lourdes [2008] - Our Lady of Lourdes Worship Site"
     ^ canonical parish   ^ year    ^ individual worship site

Usage:
    uv run python scripts/fetch_diocese_locator.py \
        https://www.buffalodiocese.org/parish-finder/ -o scratch/buffalo.json

The script discovers `ajaxurl` and the map's start coordinates from the page,
then issues one wide-radius search. Pass --radius/--max to widen if a diocese
spans more than the default 200 miles.

Note the plugin's data is only as fresh as the diocese keeps it: homepages in
particular go stale during mergers, so always run the result through
`scripts/check_parish_websites.py` before trusting a URL.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import socket
import ssl
import sys
import urllib.parse
from pathlib import Path
from urllib.request import Request, urlopen

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) project-carlo-locator/1.0"

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def fetch(url: str, timeout: int = 40) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"})
    with urlopen(req, timeout=timeout, context=_CTX) as resp:
        return resp.read()


def discover(page_url: str) -> tuple[str, str, str]:
    """Return (ajax_url, start_lat, start_lng) from the parish-finder page."""
    body = fetch(page_url).decode("utf-8", "ignore")
    ajax = re.search(r'"ajaxurl":"(https?:[^"]+admin-ajax\.php)"', body)
    if not ajax:
        raise SystemExit("no WP Store Locator ajaxurl found — is this a wpsl page?")
    latlng = re.search(r'"startLatlng":"(-?[\d.]+),(-?[\d.]+)"', body)
    lat, lng = (latlng.group(1), latlng.group(2)) if latlng else ("0", "0")
    return ajax.group(1).replace("\\/", "/"), lat, lng


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def split_name(store: str) -> tuple[str, str, str, str]:
    """Split "Parish [year] - Site Worship Site" into its parts."""
    name = clean(store)
    m = re.match(r"^(.*?)\s*[-–—]\s*(.*)$", name)
    parish, site = (m.group(1), m.group(2)) if m else (name, "")
    year_m = re.search(r"\[(\d{4})\]", parish)
    year = year_m.group(1) if year_m else ""
    parish = re.sub(r"\s*\[[^\]]*\]", "", parish).strip()
    site = re.sub(r"\s*\[[^\]]*\]", "", site).strip()
    kind = "church"
    if site.lower().endswith("worship site"):
        site, kind = site[: -len("worship site")].strip(), "worship_site"
    elif site.lower().endswith("oratory"):
        site, kind = site[: -len("oratory")].strip(), "oratory"
    return parish, site or parish, kind, year


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("page", help="URL of the diocese's parish-finder page")
    ap.add_argument("-o", "--out", type=Path, help="write JSON here (default stdout)")
    ap.add_argument("--radius", default="200", help="search radius in miles (default 200)")
    ap.add_argument("--max", default="1000", help="max results (default 1000)")
    args = ap.parse_args()

    socket.setdefaulttimeout(60)
    ajax, lat, lng = discover(args.page)
    query = urllib.parse.urlencode({"action": "store_search", "lat": lat, "lng": lng,
                                    "max_results": args.max, "search_radius": args.radius,
                                    "autoload": "1"})
    raw = json.loads(fetch(f"{ajax}?{query}"))
    print(f"locator returned {len(raw)} locations", file=sys.stderr)

    rows = []
    for x in raw:
        parish, site, kind, year = split_name(x.get("store", ""))
        rows.append({
            "parish": parish, "site": site, "site_kind": kind, "year": year,
            "line1": clean(x.get("address")), "line2": clean(x.get("address2")),
            "city": clean(x.get("city")), "state": clean(x.get("state")),
            "zip": clean(x.get("zip")), "latitude": x.get("lat"), "longitude": x.get("lng"),
            "phone": clean(x.get("phone")), "email": clean(x.get("email")),
            "website": clean(x.get("url")), "locator_id": x.get("id"),
        })

    multi = len({r["parish"] for r in rows})
    print(f"{multi} distinct canonical parishes; "
          f"{sum(1 for r in rows if not r['website'])} sites without a homepage", file=sys.stderr)

    payload = json.dumps(rows, indent=2, ensure_ascii=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
