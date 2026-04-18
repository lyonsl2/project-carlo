"""Apply detect/verify results back into source CSV files."""

from __future__ import annotations

import csv
import logging
from pathlib import Path

from pdf_extract.address import address_key
from pdf_extract.storage import (
    CHURCHES_CSV_PATH,
    DETECT_RESULTS_PATH,
    GEOCODE_RESULTS_PATH,
    PARISHES_CSV_PATH,
    VERIFY_RESULTS_PATH,
    load_json_dict,
    load_json_list,
)

LOGGER = logging.getLogger(__name__)

_PARISHES_FIELDNAMES = ["slug", "name", "website", "bulletin_provider", "provider_id"]
_CHURCHES_FIELDNAMES = [
    "parish_id", "slug", "name", "line1", "line2", "city", "state", "postal_code",
    "name_verified", "address_verified", "latitude", "longitude",
]


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    """Write rows to a CSV via a temp file, then atomically rename."""
    tmp = path.with_suffix(".csv.tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path)


def apply_detect_results() -> dict[str, int]:
    """Merge detect_results.json into parishes.csv."""
    results = load_json_dict(DETECT_RESULTS_PATH)
    if not results:
        LOGGER.info("No detect_results.json found, nothing to apply")
        return {"updated": 0, "unchanged": 0}

    rows: list[dict[str, str]] = []
    with open(PARISHES_CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(dict(row))

    updated = 0
    unchanged = 0
    for row in rows:
        slug = row["slug"]
        if slug in results:
            info = results[slug]
            row["bulletin_provider"] = info.get("bulletin_provider") or ""
            row["provider_id"] = info.get("provider_id") or ""
            updated += 1
        else:
            row.setdefault("bulletin_provider", "")
            row.setdefault("provider_id", "")
            unchanged += 1

    _write_csv(PARISHES_CSV_PATH, _PARISHES_FIELDNAMES, rows)
    DETECT_RESULTS_PATH.unlink()
    LOGGER.info("Applied detect results to parishes.csv: %d updated, %d unchanged", updated, unchanged)
    return {"updated": updated, "unchanged": unchanged}


def _verification_flag(status: str | None) -> str:
    """Map a verification status to a CSV boolean value."""
    if status == "verified":
        return "true"
    # "incorrect", "unverifiable", or missing → false (needs human review)
    return "false"


def apply_verify_results() -> dict[str, int]:
    """Merge verify_results.json into churches.csv."""
    verify_results = load_json_dict(VERIFY_RESULTS_PATH)
    if not verify_results:
        LOGGER.info("No verify_results.json found, nothing to apply")
        return {"corrections_applied": 0, "new_churches_added": 0}

    rows: list[dict[str, str]] = []
    with open(CHURCHES_CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(dict(row))

    # Build slug -> row index lookup
    slug_to_idx: dict[str, int] = {}
    for i, row in enumerate(rows):
        slug_to_idx[row["slug"]] = i

    corrected_slugs: set[str] = set()
    new_added = 0

    for parish_slug, result in verify_results.items():
        for church_v in result.get("existing_churches", []):
            church_slug = church_v.get("church_slug")
            if not church_slug or church_slug not in slug_to_idx:
                continue

            row = rows[slug_to_idx[church_slug]]
            name_status = church_v.get("name_status")
            address_status = church_v.get("address_status")

            # Apply name correction
            if name_status == "incorrect" and church_v.get("corrected_name"):
                row["name"] = church_v["corrected_name"]
                row["name_verified"] = "true"
                corrected_slugs.add(church_slug)
            else:
                row["name_verified"] = _verification_flag(name_status)

            # Apply address correction
            if address_status == "incorrect" and church_v.get("corrected_address"):
                addr = church_v["corrected_address"]
                if isinstance(addr, dict):
                    row["line1"] = addr.get("line1") or ""
                    row["line2"] = addr.get("line2") or ""
                    row["city"] = addr.get("city") or ""
                    row["state"] = addr.get("state") or ""
                    row["postal_code"] = addr.get("postal_code") or ""
                    row["address_verified"] = "true"
                    corrected_slugs.add(church_slug)
                else:
                    row["address_verified"] = _verification_flag(address_status)
            else:
                row["address_verified"] = _verification_flag(address_status)

        for new_church in result.get("new_churches", []):
            new_slug = new_church.get("slug")
            if not new_slug or not new_church.get("name"):
                LOGGER.warning("Skipping new church without slug or name: %s", new_church)
                continue
            if new_slug in slug_to_idx:
                LOGGER.warning("New church slug '%s' already exists in churches.csv, skipping", new_slug)
                continue

            addr = new_church.get("address") or {}
            if not isinstance(addr, dict):
                addr = {}
            new_row = {
                "parish_id": parish_slug,
                "slug": new_slug,
                "name": new_church["name"],
                "line1": addr.get("line1") or "",
                "line2": addr.get("line2") or "",
                "city": addr.get("city") or "",
                "state": addr.get("state") or "",
                "postal_code": addr.get("postal_code") or "",
                "name_verified": "",
                "address_verified": "",
            }
            rows.append(new_row)
            slug_to_idx[new_slug] = len(rows) - 1
            new_added += 1

    # Ensure all rows have the new columns
    for row in rows:
        row.setdefault("name_verified", "")
        row.setdefault("address_verified", "")
        row.setdefault("latitude", "")
        row.setdefault("longitude", "")

    _write_csv(CHURCHES_CSV_PATH, _CHURCHES_FIELDNAMES, rows)
    VERIFY_RESULTS_PATH.unlink()
    corrections_applied = len(corrected_slugs)
    LOGGER.info(
        "Applied verify results to churches.csv: %d corrections, %d new churches",
        corrections_applied, new_added,
    )
    return {"corrections_applied": corrections_applied, "new_churches_added": new_added}


def apply_geocode_results() -> dict[str, int]:
    """Merge geocode_results.json into churches.csv."""
    geocode_results = load_json_list(GEOCODE_RESULTS_PATH)
    if not geocode_results:
        LOGGER.info("No geocode_results.json found, nothing to apply")
        return {"updated": 0}

    # Build lookup: address_key -> (lat, lng)
    geo_lookup: dict[str, tuple[float, float]] = {}
    for geo in geocode_results:
        lat = geo.get("latitude")
        lng = geo.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            continue
        key = address_key(
            geo.get("line1"), geo.get("line2"),
            geo.get("city"), geo.get("state"), geo.get("postal_code"),
        )
        geo_lookup[key] = (lat, lng)

    rows: list[dict[str, str]] = []
    with open(CHURCHES_CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(dict(row))

    updated = 0
    for row in rows:
        key = address_key(
            row.get("line1"), row.get("line2"),
            row.get("city"), row.get("state"), row.get("postal_code"),
        )
        if key in geo_lookup:
            lat, lng = geo_lookup[key]
            row["latitude"] = str(lat)
            row["longitude"] = str(lng)
            updated += 1
        else:
            row.setdefault("latitude", "")
            row.setdefault("longitude", "")

    _write_csv(CHURCHES_CSV_PATH, _CHURCHES_FIELDNAMES, rows)
    GEOCODE_RESULTS_PATH.unlink()
    LOGGER.info("Applied geocode results to churches.csv: %d updated", updated)
    return {"updated": updated}
