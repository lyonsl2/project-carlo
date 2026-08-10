#!/usr/bin/env python
"""Liveness + sanity check for every parish website in data/parishes.csv.

Parish domains in the Dioceses of Buffalo/Rochester lapse often during the
ongoing mergers, and the model relies on the website being where the parish's
bulletin actually lives (1 parish = 1 bulletin). This script flags rows whose
domain no longer resolves, redirects off-site (often into a "family" site after
a merger), or returns no parish-looking content, so they can be re-pointed or
consolidated.

Usage:
    uv run python scripts/check_parish_websites.py            # all parishes
    uv run python scripts/check_parish_websites.py --flagged  # only problems

Heuristics are deliberately conservative; verify each flag by hand before
editing data. Known false-positive shapes are annotated in the output:
IPv6-only hosts, JS-rendered sites (little crawlable text), and bot-blocking
403/404 on `/` are common and usually fine.
"""

from __future__ import annotations

import argparse
import csv
import socket
import ssl
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PARISHES_CSV = Path(__file__).resolve().parent.parent / "data" / "parishes.csv"

SPAM = ["casino", "roulette", "betting", "sportsbook", "viagra", "cialis",
        "pesantren", "escort", "porn", "payday", "forex"]
PARISH_WORDS = ["parish", "church", "catholic", "mass", "bulletin", "diocese",
                "gospel", "liturgy", "sacrament", "worship", "rosary"]

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def _host(url: str) -> str:
    return url.split("//")[-1].split("/")[0].replace("www.", "")


def check(slug: str, url: str) -> tuple[str, str, str, str]:
    """Return (verdict, slug, url, detail). verdict 'ok' means no concern."""
    host = _host(url)
    try:  # DNS first so we can distinguish dead domains from bot-blocking
        socket.getaddrinfo(host, 443)
    except OSError as exc:
        return ("DEAD-DNS", slug, url, f"{type(exc).__name__}: {exc}")
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 (parish-liveness-check)"})
        with urlopen(req, timeout=20, context=_CTX) as resp:
            status, final = resp.status, resp.geturl()
            body = resp.read(8000).decode("utf-8", "ignore").lower()
    except HTTPError as exc:
        return (f"HTTP{exc.code}", slug, url, "resolves but server refused (often bot-blocking)")
    except (URLError, OSError) as exc:
        return ("UNREACHABLE", slug, url, f"{type(exc).__name__}: {exc} (e.g. IPv6-only host)")

    spam = [k for k in SPAM if k in body]
    good = [k for k in PARISH_WORDS if k in body]
    offsite = host.split(".")[0] not in final.lower()
    if spam:
        return ("SPAM-SQUAT", slug, url, f"spam terms: {spam}")
    if offsite:
        return ("REDIRECT-OFFSITE", slug, url, f"-> {final}  (merged into a family site?)")
    if not good:
        return ("NO-PARISH-WORDS", slug, url, f"http={status} (JS-rendered? verify by hand)")
    return ("ok", slug, url, f"http={status}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--flagged", action="store_true", help="only show non-ok rows")
    args = ap.parse_args()

    socket.setdefaulttimeout(20)
    with open(PARISHES_CSV, encoding="utf-8") as f:
        rows = [(r["slug"], r["website"]) for r in csv.DictReader(f)]

    with ThreadPoolExecutor(max_workers=12) as ex:
        results = list(ex.map(lambda r: check(*r), rows))

    order = {"DEAD-DNS": 0, "SPAM-SQUAT": 1, "REDIRECT-OFFSITE": 2,
             "UNREACHABLE": 3, "HTTP404": 4, "HTTP403": 5, "NO-PARISH-WORDS": 6, "ok": 9}
    results.sort(key=lambda r: order.get(r[0], 7))

    flagged = [r for r in results if r[0] != "ok"]
    for verdict, slug, url, detail in results:
        if args.flagged and verdict == "ok":
            continue
        print(f"[{verdict:16s}] {slug}\n    {url}\n    {detail}\n")
    print(f"--- {len(results) - len(flagged)} ok, {len(flagged)} flagged of {len(results)} ---")


if __name__ == "__main__":
    main()
