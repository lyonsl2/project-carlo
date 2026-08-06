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
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import socket
import ssl
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


def masthead(url: str, chars: int) -> str:
    """First readable page of the PDF — usually names every member parish."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return "(pypdf not installed)"
    with _open(url) as resp:
        data = resp.read()
    reader = PdfReader(io.BytesIO(data))
    for page in reader.pages:
        text = (page.extract_text() or "").strip()
        if text:
            return text[:chars]
    return f"({len(reader.pages)} pages, no extractable text — scanned images)"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("container", help='e.g. "14/0428"')
    ap.add_argument("--weeks", type=int, default=12, help="Sundays to walk back")
    ap.add_argument("--text", action="store_true",
                    help="print the latest issue's first readable page")
    ap.add_argument("--chars", type=int, default=1200)
    args = ap.parse_args()

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
        print(masthead(latest, args.chars))


if __name__ == "__main__":
    main()
