"""Shared address utilities for structured address fields."""

from __future__ import annotations

import re


def format_address(
    line1: str | None,
    line2: str | None,
    city: str | None,
    state: str | None,
    postal_code: str | None,
) -> str:
    """Format structured address fields into a single display string."""
    parts: list[str] = []
    if line1:
        parts.append(line1)
    if line2:
        parts.append(line2)
    city_state_zip: list[str] = []
    if city:
        city_state_zip.append(city)
    state_zip = " ".join(filter(None, [state, postal_code]))
    if state_zip:
        city_state_zip.append(state_zip)
    if city_state_zip:
        parts.append(", ".join(city_state_zip))
    return ", ".join(parts)


def address_key(
    line1: str | None,
    line2: str | None,
    city: str | None,
    state: str | None,
    postal_code: str | None,
) -> str:
    """Deterministic key for geocode dedup from structured address fields."""
    return "|".join(s or "" for s in (line1, line2, city, state, postal_code))


def parse_address(address_str: str) -> dict[str, str | None]:
    """Parse 'Street, City, ST ZIP' into structured fields.

    Returns dict with keys: line1, line2, city, state, postal_code.
    """
    if not address_str or not address_str.strip():
        return {"line1": None, "line2": None, "city": None, "state": None, "postal_code": None}

    # Pattern: "Street, City, ST ZIP"
    m = re.match(r"^(.+?),\s*(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$", address_str.strip())
    if m:
        return {
            "line1": m.group(1).strip(),
            "line2": None,
            "city": m.group(2).strip(),
            "state": m.group(3),
            "postal_code": m.group(4),
        }

    # Fallback: put entire string in line1
    return {
        "line1": address_str.strip(),
        "line2": None,
        "city": None,
        "state": None,
        "postal_code": None,
    }
