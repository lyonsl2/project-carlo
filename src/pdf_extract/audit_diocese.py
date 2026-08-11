"""Diff the diocese website Mass-time listing against bulletin-extracted events.

The diocese listing is transcribed in ``data/diocese_mass_times.csv``; each row
maps a listing entry to a ``churches.csv`` slug (blank when the project has no
matching church). Extracted Mass times come from ``data/events.json``.

Run with ``python -m pdf_extract audit-diocese`` (or call :func:`build_report`).
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

DAY_ABBR = {
    "Sun": "Sunday",
    "Mon": "Monday",
    "Tue": "Tuesday",
    "Wed": "Wednesday",
    "Thu": "Thursday",
    "Fri": "Friday",
    "Sat": "Saturday",
}
WEEKEND = {"Saturday", "Sunday"}
DAY_ORDER = {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6,
}

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DIOCESE_CSV = DATA_DIR / "diocese_mass_times.csv"
CHURCHES_CSV = DATA_DIR / "churches.csv"
EVENTS_JSON = DATA_DIR / "events.json"
METADATA_JSON = DATA_DIR / "metadata.json"

_TIME_RE = re.compile(r"^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2}):(\d{2})\s*(AM|PM)$")


def parse_slot(text: str) -> tuple[str, str]:
    """Turn ``"Sun 9:30 AM"`` into ``("Sunday", "9:30 AM")``."""
    match = _TIME_RE.match(text.strip())
    if not match:
        raise ValueError(f"unparseable Mass slot: {text!r}")
    day, hour, minute, meridiem = match.groups()
    return DAY_ABBR[day], f"{int(hour)}:{minute} {meridiem}"


def slot_key(slot: tuple[str, str]) -> tuple[int, int]:
    day, time = slot
    hour, rest = time.split(":")
    minute, meridiem = rest.split(" ")
    hour24 = int(hour) % 12 + (12 if meridiem == "PM" else 0)
    return DAY_ORDER[day], hour24 * 60 + int(minute)


def fmt(slots) -> str:
    return ", ".join(f"{d} {t}" for d, t in sorted(slots, key=slot_key)) or "(none)"


@dataclass
class ChurchAudit:
    slug: str
    name: str = ""
    city: str = ""
    parish_id: str = ""
    listings: list[dict] = field(default_factory=list)
    diocese: set = field(default_factory=set)
    bulletin: set = field(default_factory=set)
    bulletin_date: str | None = None

    @property
    def diocese_lists_weekdays(self) -> bool:
        """Most diocese entries publish weekend times only."""
        return any(day not in WEEKEND for day, _ in self.diocese)

    def _scoped(self, slots: set) -> set:
        """Drop weekday slots when the diocese entry never listed weekdays."""
        if self.diocese_lists_weekdays:
            return slots
        return {slot for slot in slots if slot[0] in WEEKEND}

    @property
    def missing_from_bulletin(self) -> set:
        return self.diocese - self.bulletin

    @property
    def missing_from_diocese(self) -> set:
        return self._scoped(self.bulletin - self.diocese)

    @property
    def weekday_only_in_bulletin(self) -> set:
        """Weekday Masses the bulletin has that the listing simply never covers."""
        if self.diocese_lists_weekdays:
            return set()
        return {slot for slot in self.bulletin - self.diocese if slot[0] not in WEEKEND}

    @property
    def status(self) -> str:
        if not self.bulletin:
            return "no-bulletin-data"
        if not self.diocese:
            return "not-listed-by-diocese"
        if not (self.missing_from_bulletin or self.missing_from_diocese):
            return "match"
        return "mismatch"


def load_diocese_rows(path: Path = DIOCESE_CSV) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_churches(path: Path = CHURCHES_CSV) -> dict[str, dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["slug"]: row for row in csv.DictReader(handle)}


def load_bulletin_slots(path: Path = EVENTS_JSON) -> tuple[dict[str, set], dict[str, str]]:
    """Weekly, non-cancelled Mass slots per church slug, plus source bulletin URL."""
    events = json.loads(path.read_text(encoding="utf-8"))
    slots: dict[str, set] = defaultdict(set)
    sources: dict[str, str] = {}
    for event in events:
        if event["event_type"] != "mass" or event["event_kind"] != "weekly":
            continue
        if event.get("cancelled"):
            continue
        slots[event["church_slug"]].add((event["day_of_week"], event["start_time"]))
        sources.setdefault(event["church_slug"], event["bulletin_source_url"])
    return slots, sources


def load_bulletin_dates(path: Path = METADATA_JSON) -> dict[str, str]:
    """Published (or fetched) date per bulletin source URL."""
    records = json.loads(path.read_text(encoding="utf-8"))
    return {
        record["source_url"]: (record.get("published_date") or record.get("fetched_at") or "")
        for record in records
    }


def build_report() -> list[ChurchAudit]:
    churches = load_churches()
    bulletin_slots, bulletin_sources = load_bulletin_slots()
    bulletin_dates = load_bulletin_dates()

    audits: dict[str, ChurchAudit] = {}

    def audit_for(slug: str) -> ChurchAudit:
        if slug not in audits:
            church = churches.get(slug, {})
            audits[slug] = ChurchAudit(
                slug=slug,
                name=church.get("name", ""),
                city=church.get("city", ""),
                parish_id=church.get("parish_id", ""),
                bulletin=set(bulletin_slots.get(slug, set())),
                bulletin_date=bulletin_dates.get(bulletin_sources.get(slug, ""), None),
            )
        return audits[slug]

    unmapped: list[dict] = []
    for row in load_diocese_rows():
        slug = row["church_slug"].strip()
        if not slug:
            unmapped.append(row)
            continue
        audit = audit_for(slug)
        audit.listings.append(row)
        for chunk in filter(None, (part.strip() for part in row["times"].split("|"))):
            audit.diocese.add(parse_slot(chunk))

    for slug in bulletin_slots:
        audit_for(slug)

    report = sorted(audits.values(), key=lambda a: (a.parish_id, a.slug))
    for audit in report:
        audit.unmapped_listings = unmapped  # type: ignore[attr-defined]
    return report


def run() -> dict:
    """Print the audit and return a summary dict (used by the CLI)."""
    report = build_report()
    buckets: dict[str, list[ChurchAudit]] = defaultdict(list)
    for audit in report:
        buckets[audit.status].append(audit)

    for audit in buckets["mismatch"]:
        print(f"{audit.slug} ({audit.name}, {audit.city}) bulletin={audit.bulletin_date}")
        print(f"    diocese : {fmt(audit.diocese)}")
        print(f"    bulletin: {fmt(audit.bulletin)}")
        if audit.missing_from_bulletin:
            print(f"    >> diocese only : {fmt(audit.missing_from_bulletin)}")
        if audit.missing_from_diocese:
            print(f"    >> bulletin only: {fmt(audit.missing_from_diocese)}")

    print("\n-- no bulletin data --")
    for audit in buckets["no-bulletin-data"]:
        print(f"    {audit.slug} ({audit.name or '?'}, {audit.city or '?'}): {fmt(audit.diocese)}")

    print("\n-- extracted but not listed by the diocese --")
    for audit in buckets["not-listed-by-diocese"]:
        print(f"    {audit.slug} ({audit.name}, {audit.city}): {fmt(audit.bulletin)}")

    unmapped = getattr(report[0], "unmapped_listings", []) if report else []
    print("\n-- diocese listings with no church_slug mapping --")
    for row in unmapped:
        print(f"    #{row['listing_id']:>3} {row['listing_name']} ({row['location']}): {row['times'] or '(none)'}")

    print()
    summary = {label: len(buckets[label]) for label in
               ("match", "mismatch", "no-bulletin-data", "not-listed-by-diocese")}
    for label, count in summary.items():
        print(f"{label:24} {count}")
    summary["unmapped-listings"] = len(unmapped)
    summary["churches-audited"] = len(report)
    return summary


if __name__ == "__main__":  # pragma: no cover
    run()
    raise SystemExit(0)
