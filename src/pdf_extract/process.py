"""Bulletin process pipeline: extract schedules from PDFs with Gemini AI."""

from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher
from pathlib import Path

from pdf_extract.schedule_extraction import extract_events
from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    CHURCHES_PATH,
    EVENTS_PATH,
    connect_db,
    get_parish_by_name,
    load_json_list,
    save_json_list,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)


def normalize_church_name(name: str | None) -> str:
    if not name:
        return ""
    normalized = name.lower()
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(r"\bst\b", "saint", normalized)
    normalized = re.sub(r"\bchurch\s*$", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _normalize_address(address: str | None) -> str:
    if not address:
        return ""
    normalized = address.lower()
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


# ── Church matching (in-memory against churches list) ───────────────────────

def _find_matching_church(
    churches: list[dict],
    parish_slug: str,
    name_normalized: str,
    address: str | None,
    threshold: float = 0.90,
) -> dict | None:
    """Find a matching church in the list by address or name similarity."""
    candidates = [c for c in churches if c["parish_slug"] == parish_slug]
    address_norm = _normalize_address(address)

    # Try exact address match first
    if address_norm:
        for c in candidates:
            if _normalize_address(c.get("address")) == address_norm:
                return c

    # Then fuzzy name match
    best: dict | None = None
    best_score = 0.0
    for c in candidates:
        c_norm = c.get("name_normalized", "")
        if name_normalized and c_norm:
            if name_normalized == c_norm:
                return c
            score = SequenceMatcher(None, name_normalized, c_norm).ratio()
            if score > best_score:
                best_score = score
                best = c

    if best is not None and best_score >= threshold:
        return best
    return None


# ── Pipeline: process ───────────────────────────────────────────────────────

def process_bulletins(
    *,
    parish_name: str | None = None,
    model: str = "gemini-3-flash-preview",
) -> dict[str, int]:
    LOGGER.info("Starting process stage (parish_name=%s, model=%s)", parish_name or "*all*", model)
    metadata = load_json_list(BULLETINS_METADATA_PATH)
    churches = load_json_list(CHURCHES_PATH)
    events = load_json_list(EVENTS_PATH)

    # Filter to pending bulletins (not yet processed, have a PDF)
    pending = [m for m in metadata if m.get("processed_at") is None and m.get("pdf_path")]

    if parish_name:
        conn = connect_db()
        try:
            parish_row = get_parish_by_name(conn, parish_name)
        finally:
            conn.close()
        if parish_row:
            target_slug = parish_row["slug"]
            pending = [m for m in pending if m["parish_slug"] == target_slug]

    processed_count = 0
    inserted_events = 0

    for entry in pending:
        pdf_path = Path(entry["pdf_path"])
        if not pdf_path.exists():
            LOGGER.warning("Skipping: PDF missing at %s", pdf_path)
            continue

        try:
            pdf_bytes = pdf_path.read_bytes()
        except OSError:
            LOGGER.warning("Skipping: failed reading PDF at %s", pdf_path, exc_info=True)
            continue

        extracted = extract_events(pdf_bytes, model=model)
        parish_slug = entry["parish_slug"]

        # Build mapping: extracted church id → name_normalized
        church_map: dict[str, str] = {}
        for ch in extracted.get("churches", []):
            if not isinstance(ch, dict):
                continue
            extracted_id = ch.get("id")
            if not isinstance(extracted_id, str) or not extracted_id:
                continue

            ch_name = ch.get("name") if isinstance(ch.get("name"), str) else None
            ch_address = ch.get("address") if isinstance(ch.get("address"), str) else None
            name_normalized = normalize_church_name(ch_name)

            existing = _find_matching_church(churches, parish_slug, name_normalized, ch_address)
            if existing is not None:
                # Update address if missing
                if ch_address and not existing.get("address"):
                    existing["address"] = ch_address
                church_map[extracted_id] = existing["name_normalized"]
            else:
                churches.append({
                    "parish_slug": parish_slug,
                    "name": ch_name,
                    "address": ch_address,
                    "name_normalized": name_normalized or None,
                    "latitude": None,
                    "longitude": None,
                })
                church_map[extracted_id] = name_normalized

        # Process events
        for ev in extracted.get("events", []):
            if not isinstance(ev, dict):
                continue
            extracted_church_id = ev.get("church_id")
            if not isinstance(extracted_church_id, str):
                continue
            church_name_norm = church_map.get(extracted_church_id)
            if not church_name_norm:
                continue

            events.append({
                "parish_slug": parish_slug,
                "church_name_normalized": church_name_norm,
                "bulletin_source_url": entry["source_url"],
                "event_type": str(ev.get("type", "")),
                "event_kind": str(ev.get("kind", "")),
                "day_of_week": ev.get("day_of_week") if isinstance(ev.get("day_of_week"), str) else None,
                "date": ev.get("date") if isinstance(ev.get("date"), str) else None,
                "start_time": str(ev.get("start_time", "")),
                "end_time": ev.get("end_time") if isinstance(ev.get("end_time"), str) else None,
                "cancelled": bool(ev.get("cancelled", False)),
                "raw_json": json.dumps(ev, sort_keys=True),
            })
            inserted_events += 1

        entry["processed_at"] = utc_now_iso()
        processed_count += 1
        save_json_list(BULLETINS_METADATA_PATH, metadata)
        save_json_list(CHURCHES_PATH, churches)
        save_json_list(EVENTS_PATH, events)

    result = {"processed_bulletins": processed_count, "inserted_events": inserted_events}
    LOGGER.info("Process stage finished: %s", result)
    return result
