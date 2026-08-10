#!/usr/bin/env python
"""Find the most recent issue in a ParishesOnline bulletin container.

ParishesOnline serves bulletins from a flat, unauthenticated path

    https://container.parishesonline.com/bulletins/<a>/<b>/<YYYYMMDD>B.pdf

with one PDF per Sunday. Walking Sundays backwards from today answers the
question that decides how a "family of parishes" gets modelled (docs §1):
*is this combined bulletin the current arrangement, or a historical one?*

That is how the Central Niagara merge was settled — the family's combined
container was still publishing this week while St. Brendan on the Lake's own
former container had gone silent, which is what "one parish = one bulletin"
looks like from the outside.

    uv run python scripts/probe_bulletin_container.py 14/0428
    uv run python scripts/probe_bulletin_container.py 14/0428 --weeks 26 --text

Note a missing object answers 403, not 404, so "403 for every Sunday probed"
is the signal that a container is dead. Confirm against a container you know is
live before concluding anything from that.

The masthead is not always on the first readable page: LPi wraps many bulletins
in a generic cover reflection, so page 1 is a homily about carbohydrates and the
member parishes are on page 2 or 3. `--pages` prints several pages for that
reason — a container that looks anonymous is usually just a page short.
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import socket
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://container.parishesonline.com/bulletins"
UA = "Mozilla/5.0 (project-carlo bulletin probe)"

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def _open(url: str, method: str = "GET"):
    return urlopen(Request(url, headers={"User-Agent": UA}, method=method),
                   timeout=30, context=_CTX)


def probe(url: str) -> int | str:
    try:
        with _open(url, "HEAD") as resp:
            return resp.status
    except HTTPError as exc:
        return exc.code
    except (URLError, OSError) as exc:
        return type(exc).__name__


def masthead(url: str, chars: int, pages: int = 1) -> str:
    """First `pages` readable pages of the PDF — one of them names every member parish."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return "(pypdf not installed)"
    with _open(url) as resp:
        data = resp.read()
    reader = PdfReader(io.BytesIO(data))
    found = []
    for n, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        if text:
            found.append(f"--- page {n} ---\n{text[:chars]}")
        if len(found) >= pages:
            break
    if not found:
        return f"({len(reader.pages)} pages, no extractable text — scanned images)"
    return "\n\n".join(found)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("container", help='e.g. "14/0428"')
    ap.add_argument("--weeks", type=int, default=12, help="Sundays to walk back")
    ap.add_argument("--text", action="store_true",
                    help="print the latest issue's first readable page(s)")
    ap.add_argument("--chars", type=int, default=1200)
    ap.add_argument("--pages", type=int, default=1,
                    help="readable pages to print; LPi covers push the masthead to page 2-3")
    args = ap.parse_args()

    # Bulletins are full of typographic quotes and ligatures; a cp1252 console
    # would crash on them rather than print the masthead we came for.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    socket.setdefaulttimeout(30)
    today = dt.date.today()
    sunday = today - dt.timedelta(days=(today.weekday() + 1) % 7)

    latest = None
    for i in range(args.weeks):
        d = sunday - dt.timedelta(weeks=i)
        url = f"{BASE}/{args.container}/{d:%Y%m%d}B.pdf"
        status = probe(url)
        print(f"{d}  {'FOUND' if status == 200 else status}")
        if status == 200:
            latest = url
            break

    if not latest:
        print(f"\nno issue in the last {args.weeks} weeks — container looks dead")
        raise SystemExit(1)

    print(f"\nlatest: {latest}")
    if args.text:
        print()
        print(masthead(latest, args.chars, args.pages))


if __name__ == "__main__":
    main()
