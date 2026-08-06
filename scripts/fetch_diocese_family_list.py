#!/usr/bin/env python
"""Parse a diocese's "Family of Parishes" assignment masterlist PDF.

The Diocese of Buffalo publishes, and periodically re-issues, a masterlist of
every Family of Parishes with its member parishes and each parish's worship
sites. It is laid out as a two-level bullet list:

    Family #14 (Fields of Grace)
    * St. John Neumann, Strykersville     <- U+2022, a canonical PARISH
      o St. Vincent, Attica               <- U+25E6, a WORSHIP SITE of it
      o St. Joseph, Varysburg
      o St. Cecilia, Sheldon
    * St. Michael, Warsaw
      o St. Mary, Pavilion

This is the best available answer to the *structure* question -- which building
belongs to which parish, and which parishes are grouped -- because it is the
diocese's own current record and it is dated. The parish-finder feed
(`fetch_diocese_locator.py`) is better for addresses and coordinates but lags
badly on structure: it still lists churches this document has already dropped.

    uv run python scripts/fetch_diocese_family_list.py -o families.json
    uv run python scripts/fetch_diocese_family_list.py --print

IMPORTANT -- a Family is NOT automatically one bulletin, and the bulletin is what
`data/parishes.csv` models (docs §1). Several families here are 4-5 parishes
that each publish separately. Use this document to learn the structure, then
confirm the bulletin with `scripts/probe_bulletin_container.py` (docs §4b)
before collapsing a family into a single parish row.

What it *is* decisive for: a "worship site" line means that building shares its
parish's bulletin, so any such site under a parish already in `parishes.csv` can
be added as a church row directly.

The trailing pages repeat the family numbers alongside schools and other
non-parish entries; everything after the first repeat of "Family #1" is ignored.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import ssl
import sys
from pathlib import Path
from urllib.request import Request, urlopen

DEFAULT_URL = ("https://www.buffalodiocese.org/wp-content/uploads/"
               "Family-of-Parishes-Assignment-Listing.pdf")

BULLET_PARISH = "•"   # filled bullet
BULLET_SITE = "◦"     # hollow bullet
FAMILY_RE = re.compile(r"^Family\s*#(\d+)\s*(?:\((.*?)\))?\s*$")

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


# The PDF is typeset with real ligatures, so "Oakfield" extracts as "Oakﬁeld"
# and silently fails to match "Oakfield" from any other source. Same for
# Westfield and St. Pacificus. Normalise them away before anything else.
LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl",
             "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
             "’": "'", "‘": "'", "“": '"', "”": '"',
             "–": "-", "—": "-", " ": " "}


def normalise(text: str) -> str:
    for bad, good in LIGATURES.items():
        text = text.replace(bad, good)
    return text


def fetch_text(url: str) -> str:
    from pypdf import PdfReader

    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (project-carlo)"})
    with urlopen(req, timeout=90, context=_CTX) as resp:
        data = resp.read()
    reader = PdfReader(io.BytesIO(data))
    return normalise("\n".join((page.extract_text() or "") for page in reader.pages))


def split_place(entry: str) -> tuple[str, str]:
    """"St. Vincent, Attica" -> ("St. Vincent", "Attica")."""
    # A few entries list several towns for one parish ("Newfane, Olcott, Wilson").
    name, _, city = entry.partition(",")
    return name.strip(), city.strip()


def parse(text: str) -> list[dict]:
    families: list[dict] = []
    current: dict | None = None
    parish: dict | None = None
    seen_numbers: set[str] = set()

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = FAMILY_RE.match(line)
        if m:
            number, name = m.group(1), (m.group(2) or "").strip()
            # the tail of the document repeats bare family numbers next to
            # schools; stop collecting once a number comes back around
            if number in seen_numbers:
                current = parish = None
                continue
            seen_numbers.add(number)
            current = {"family": int(number), "name": name, "parishes": []}
            families.append(current)
            parish = None
            continue
        if current is None:
            continue
        if line.startswith(BULLET_PARISH):
            name, city = split_place(line[1:])
            parish = {"parish": name, "city": city, "sites": []}
            current["parishes"].append(parish)
        elif line.startswith(BULLET_SITE) and parish is not None:
            name, city = split_place(line[1:])
            parish["sites"].append({"site": name, "city": city})

    return [f for f in families if f["parishes"]]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--print", dest="show", action="store_true")
    args = ap.parse_args()

    families = parse(fetch_text(args.url))
    parishes = sum(len(f["parishes"]) for f in families)
    sites = sum(len(p["sites"]) for f in families for p in f["parishes"])
    print(f"{len(families)} families, {parishes} parishes, {sites} worship sites",
          file=sys.stderr)

    if args.show:
        for f in families:
            print(f"\nFamily #{f['family']} ({f['name']})")
            for p in f["parishes"]:
                print(f"  PARISH {p['parish']}, {p['city']}")
                for s in p["sites"]:
                    print(f"      site {s['site']}, {s['city']}")

    payload = json.dumps(families, indent=2, ensure_ascii=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    elif not args.show:
        print(payload)


if __name__ == "__main__":
    main()
