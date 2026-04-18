"""Bulletin process pipeline: extract schedules from PDFs with Gemini AI."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from pdf_extract.address import format_address
from pdf_extract.pdf_truncate import ensure_truncated_pdf
from pdf_extract.schedule_extraction import extract_events
from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    EVENTS_PATH,
    connect_db,
    get_parish_by_name,
    list_churches,
    load_json_list,
    save_json_list,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)


@dataclass
class _WorkItem:
    entry: dict[str, Any]
    pdf_bytes: bytes
    church_list: list[dict[str, Any]]


def _latest_per_parish(metadata: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only the most recently fetched bulletin for each parish."""
    latest_by_parish: dict[str, tuple[tuple[str, str, int], dict[str, Any]]] = {}
    for idx, entry in enumerate(metadata):
        parish_slug = entry.get("parish_slug")
        if not isinstance(parish_slug, str):
            continue
        fetched_at = str(entry.get("fetched_at") or "")
        # Use source-order as a final tie-breaker to keep behavior deterministic.
        rank = (fetched_at, str(entry.get("published_date") or ""), idx)
        current = latest_by_parish.get(parish_slug)
        if current is None or rank > current[0]:
            latest_by_parish[parish_slug] = (rank, entry)
    return [item[1] for item in latest_by_parish.values()]


def _prepare_work_item(entry: dict[str, Any], conn) -> _WorkItem | None:
    """Load PDF bytes and churches for a bulletin entry.

    Returns None (and logs a warning) if the bulletin should be skipped.
    Runs on the main thread so the sqlite connection stays single-threaded.
    """
    pdf_path = Path(entry["pdf_path"])
    if not pdf_path.exists():
        LOGGER.warning("Skipping: PDF missing at %s", pdf_path)
        return None

    try:
        read_path = ensure_truncated_pdf(pdf_path)
    except Exception:
        LOGGER.warning("Skipping: failed truncating PDF at %s", pdf_path, exc_info=True)
        return None

    try:
        pdf_bytes = read_path.read_bytes()
    except OSError:
        LOGGER.warning("Skipping: failed reading PDF at %s", read_path, exc_info=True)
        return None

    parish_slug = entry["parish_slug"]
    parish_row = conn.execute(
        "SELECT id FROM parish WHERE slug = ?", (parish_slug,)
    ).fetchone()
    if not parish_row:
        LOGGER.warning("Skipping: parish %s not found in DB", parish_slug)
        return None

    church_rows = list_churches(conn, parish_row["id"])
    church_list = [
        {
            "slug": r["slug"],
            "name": r["name"],
            "address": format_address(
                r["address_line1"], r["address_line2"],
                r["city"], r["state"], r["postal_code"],
            ),
        }
        for r in church_rows
    ]

    return _WorkItem(entry=entry, pdf_bytes=pdf_bytes, church_list=church_list)


def _merge_extracted(
    entry: dict[str, Any],
    extracted: dict[str, Any],
    events: list[dict[str, Any]],
) -> int:
    """Merge an extracted result into `events` and update `entry` in place.

    Returns the number of events appended.
    """
    parish_slug = entry["parish_slug"]

    published_date = extracted.get("published_date")
    if isinstance(published_date, str) and published_date.strip():
        entry["published_date"] = published_date

    appended = 0
    if extracted.get("wrong_bulletin"):
        LOGGER.warning(
            "Bulletin flagged as wrong PDF for parish %s (source=%s); skipping events",
            parish_slug, entry.get("source_url"),
        )
    else:
        for ev in extracted.get("events", []):
            if not isinstance(ev, dict):
                continue
            church_slug = ev.get("church_slug")
            if not isinstance(church_slug, str):
                continue

            note_raw = ev.get("note")
            note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None

            events.append({
                "church_slug": church_slug,
                "bulletin_source_url": entry["source_url"],
                "event_type": str(ev.get("type", "")),
                "event_kind": str(ev.get("kind", "")),
                "day_of_week": ev.get("day_of_week") if isinstance(ev.get("day_of_week"), str) else None,
                "date": ev.get("date") if isinstance(ev.get("date"), str) else None,
                "start_time": str(ev.get("start_time", "")),
                "end_time": ev.get("end_time") if isinstance(ev.get("end_time"), str) else None,
                "cancelled": bool(ev.get("cancelled", False)),
                "page_number": ev.get("page_number") if isinstance(ev.get("page_number"), int) else None,
                "note": note,
            })
            appended += 1

    if extracted.get("church_list_needs_review"):
        LOGGER.warning(
            "Church list may need review for parish %s — run 'pnpm verify --parish \"%s\"'",
            parish_slug, parish_slug,
        )

    entry["processed_at"] = utc_now_iso()
    return appended


def process_bulletins(
    *,
    parish_name: str | None = None,
    model: str = "gemini-3-flash-preview",
    concurrency: int = 5,
) -> dict[str, int]:
    LOGGER.info(
        "Starting process stage (parish_name=%s, model=%s, concurrency=%s)",
        parish_name or "*all*", model, concurrency,
    )
    metadata = load_json_list(BULLETINS_METADATA_PATH)
    events = load_json_list(EVENTS_PATH)

    # Keep only the latest fetched bulletin per parish, then process those still pending.
    latest = [m for m in metadata if m.get("pdf_path")]
    latest = _latest_per_parish(latest)
    pending = [m for m in latest if m.get("processed_at") is None]

    conn = connect_db()
    try:
        if parish_name:
            parish_row = get_parish_by_name(conn, parish_name)
            if not parish_row:
                LOGGER.warning("Parish not found: %s", parish_name)
                return {"processed_bulletins": 0, "inserted_events": 0}
            target_slug = parish_row["slug"]
            pending = [m for m in pending if m["parish_slug"] == target_slug]

        # Phase 1: prepare work items serially so the sqlite connection stays
        # on the main thread.
        work_items: list[_WorkItem] = []
        for entry in pending:
            prepared = _prepare_work_item(entry, conn)
            if prepared is not None:
                work_items.append(prepared)

        processed_count = 0
        inserted_events = 0

        if not work_items:
            result = {"processed_bulletins": 0, "inserted_events": 0}
            LOGGER.info("Process stage finished: %s", result)
            return result

        # Phase 2: call extract_events in parallel via a thread pool.
        # Phase 3 (result merging + JSON writes) runs back on the main thread
        # as each future completes, so no locking is needed.
        today = date.today()
        max_workers = max(1, min(concurrency, len(work_items)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(
                    extract_events,
                    item.pdf_bytes,
                    churches=item.church_list,
                    model=model,
                    today=today,
                ): item
                for item in work_items
            }
            for fut in as_completed(futures):
                item = futures[fut]
                try:
                    extracted = fut.result()
                except Exception:
                    LOGGER.warning(
                        "extract_events failed for %s",
                        item.entry.get("source_url"),
                        exc_info=True,
                    )
                    continue

                inserted_events += _merge_extracted(item.entry, extracted, events)
                processed_count += 1
                save_json_list(BULLETINS_METADATA_PATH, metadata)
                save_json_list(EVENTS_PATH, events)
    finally:
        conn.close()

    result = {"processed_bulletins": processed_count, "inserted_events": inserted_events}
    LOGGER.info("Process stage finished: %s", result)
    return result
