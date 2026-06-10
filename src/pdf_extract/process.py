"""Bulletin process pipeline: extract schedules from PDFs with Gemini AI.

Runs the production Gemini classifier over each parish's latest fetched
bulletin. `processed_at` in metadata.json is the gate that keeps a bulletin
from being re-extracted; the shared on-disk result cache under data/runs/
(keyed by classifier version + bulletin content hash) is a second layer that
lets a re-run after a metadata reset skip the API call.

data/events.json is derived state: it holds exactly the events of each
parish's most recent processed bulletin, and rows from superseded bulletins
are compacted away on every run.
"""

from __future__ import annotations

import logging
from typing import Any

from pdf_extract.classifiers.gemini import GeminiClassifier
from pdf_extract.runner import (
    flatten_extracted_events,
    iter_extraction_outcomes,
    latest_per_parish,
    load_cached_result,
    store_cached_result,
)
from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    EVENTS_PATH,
    connect_db,
    get_parish_by_name,
    load_json_list,
    save_json_list,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3-flash-preview"


def _frontend_bulletin_rank(entry: dict[str, Any], idx: int) -> tuple[str, str, str, int]:
    """Bulletin recency as the frontend sees it.

    Mirrors the latest-bulletin ORDER BY in extract_frontend_db.py
    (published_date, fetched_at, processed_at, insertion order). This is
    deliberately different from `latest_per_parish` (fetched_at first), which
    decides what to *process*: some parish sites re-serve old issues, so the
    most recently fetched bulletin is not always the most recently published.
    """
    return (
        str(entry.get("published_date") or ""),
        str(entry.get("fetched_at") or ""),
        str(entry.get("processed_at") or ""),
        idx,
    )


def compact_events(
    events: list[dict[str, Any]], metadata: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep only rows belonging to each parish's frontend-visible bulletin.

    Without compaction, rows from superseded bulletins (and bulletins no longer
    present in metadata.json) accumulate in events.json forever. Ranking
    follows `_frontend_bulletin_rank` so compaction never drops a row the
    frontend would display.
    """
    top_by_parish: dict[str, tuple[tuple[str, str, str, int], Any]] = {}
    for idx, entry in enumerate(metadata):
        parish_slug = entry.get("parish_slug")
        if not isinstance(parish_slug, str) or not entry.get("processed_at"):
            continue
        rank = _frontend_bulletin_rank(entry, idx)
        current = top_by_parish.get(parish_slug)
        if current is None or rank > current[0]:
            top_by_parish[parish_slug] = (rank, entry.get("source_url"))
    keep_urls = {url for _, url in top_by_parish.values()}
    return [e for e in events if e.get("bulletin_source_url") in keep_urls]


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

    if extracted.get("wrong_bulletin"):
        LOGGER.warning(
            "Bulletin flagged as wrong PDF for parish %s (source=%s); skipping events",
            parish_slug, entry.get("source_url"),
        )
    rows = flatten_extracted_events(entry, extracted)
    events.extend(rows)

    if extracted.get("church_list_needs_review"):
        LOGGER.warning(
            "Church list may need review for parish %s — run 'pnpm verify --parish \"%s\"'",
            parish_slug, parish_slug,
        )

    entry["processed_at"] = utc_now_iso()
    return len(rows)


def process_bulletins(
    *,
    parish_name: str | None = None,
    model: str = DEFAULT_MODEL,
    concurrency: int = 5,
) -> dict[str, int]:
    LOGGER.info(
        "Starting process stage (parish_name=%s, model=%s, concurrency=%s)",
        parish_name or "*all*", model, concurrency,
    )
    classifier = GeminiClassifier(model=model)
    metadata = load_json_list(BULLETINS_METADATA_PATH)

    # Keep only the latest fetched bulletin per parish, then process those still pending.
    latest = [m for m in metadata if m.get("pdf_path")]
    latest = latest_per_parish(latest)
    pending = [m for m in latest if m.get("processed_at") is None]

    processed_count = 0
    inserted_events = 0
    cache_hits = 0

    conn = connect_db()
    try:
        if parish_name:
            parish_row = get_parish_by_name(conn, parish_name)
            if not parish_row:
                LOGGER.warning("Parish not found: %s", parish_name)
                return {"processed_bulletins": 0, "inserted_events": 0, "cache_hits": 0}
            target_slug = parish_row["slug"]
            pending = [m for m in pending if m["parish_slug"] == target_slug]

        # events.json is derived state; drop rows from superseded bulletins
        # before merging anything new.
        events = load_json_list(EVENTS_PATH)
        compacted = compact_events(events, metadata)
        if len(compacted) != len(events):
            LOGGER.info(
                "Compacted events.json: dropped %d stale rows",
                len(events) - len(compacted),
            )
            events = compacted
            save_json_list(EVENTS_PATH, events)

        def commit(entry: dict[str, Any], extracted: dict[str, Any]) -> None:
            """Merge one result, re-compact, and persist both files for crash safety."""
            nonlocal events, inserted_events, processed_count
            inserted_events += _merge_extracted(entry, extracted, events)
            processed_count += 1
            events = compact_events(events, metadata)
            save_json_list(BULLETINS_METADATA_PATH, metadata)
            save_json_list(EVENTS_PATH, events)

        # Serve bulletins whose extraction is already cached without an API call.
        uncached: list[dict[str, Any]] = []
        for entry in pending:
            content_hash = entry.get("content_hash")
            cached = (
                load_cached_result(classifier.name, classifier.version, content_hash)
                if isinstance(content_hash, str) and content_hash
                else None
            )
            if cached is None:
                uncached.append(entry)
                continue
            cache_hits += 1
            commit(entry, cached)

        for outcome in iter_extraction_outcomes(
            uncached, conn, classifier.extract, concurrency=concurrency,
        ):
            if outcome.skipped or outcome.extracted is None:
                continue
            content_hash = outcome.entry.get("content_hash")
            if isinstance(content_hash, str) and content_hash:
                store_cached_result(
                    classifier.name, classifier.version, content_hash, outcome.extracted,
                )
            commit(outcome.entry, outcome.extracted)
    finally:
        conn.close()

    result = {
        "processed_bulletins": processed_count,
        "inserted_events": inserted_events,
        "cache_hits": cache_hits,
    }
    LOGGER.info("Process stage finished: %s", result)
    return result
