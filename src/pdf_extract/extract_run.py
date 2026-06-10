"""Experimental classifier runner: runs a registered classifier against the
fetched bulletin corpus and writes its outputs to data/runs/<classifier>/.

Independent of the production process.py bookkeeping:
- does not consult or update the `processed_at` field in metadata.json
- does not write data/events.json
- does not touch the SQLite parish_events.db beyond reads

It shares the on-disk result cache with the production path (see runner.py):
each classifier output is keyed by (classifier name + version, bulletin
content_hash). A cache hit means zero classifier calls on re-run.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from pdf_extract.classifiers import Classifier, get_classifier
from pdf_extract.runner import (
    flatten_extracted_events,
    iter_extraction_outcomes,
    latest_per_parish,
    load_cached_result,
    run_dir,
    store_cached_result,
)
from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    connect_db,
    get_parish_by_name,
    load_json_list,
    save_json_list,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)


# ── On-disk layout ──────────────────────────────────────────────────────────
def events_path(classifier_name: str) -> Path:
    return run_dir(classifier_name) / "events.json"


def bulletins_path(classifier_name: str) -> Path:
    return run_dir(classifier_name) / "bulletins.json"


def run_summary_path(classifier_name: str) -> Path:
    return run_dir(classifier_name) / "run.json"


# ── Main entry point ────────────────────────────────────────────────────────
def run(
    *,
    classifier_name: str,
    parish_name: str | None = None,
    concurrency: int = 5,
) -> dict[str, Any]:
    """Run a classifier over the fetched bulletin corpus.

    Re-uses cached classifier outputs keyed by (classifier+version, content_hash).
    Always rebuilds events.json from the cache so it stays in sync.
    """
    classifier = get_classifier(classifier_name)
    LOGGER.info(
        "Starting extract run (classifier=%s version=%s parish=%s concurrency=%s)",
        classifier.name,
        classifier.version,
        parish_name or "*all*",
        concurrency,
    )

    metadata = load_json_list(BULLETINS_METADATA_PATH)
    candidates = [m for m in metadata if m.get("pdf_path")]
    candidates = latest_per_parish(candidates)

    started = time.monotonic()
    cache_hits = 0
    cache_misses = 0
    skipped = 0
    errors: list[dict[str, str]] = []
    cached_results: dict[str, dict[str, Any]] = {}  # source_url -> classifier output

    conn = connect_db()
    try:
        if parish_name:
            parish_row = get_parish_by_name(conn, parish_name)
            if not parish_row:
                LOGGER.warning("Parish not found: %s", parish_name)
                return _empty_summary(classifier)
            target_slug = parish_row["slug"]
            candidates = [m for m in candidates if m["parish_slug"] == target_slug]

        # Pass 1: serve everything we already have cached, build the work list.
        pending: list[dict[str, Any]] = []
        for entry in candidates:
            content_hash = entry.get("content_hash")
            if not isinstance(content_hash, str) or not content_hash:
                LOGGER.warning(
                    "Skipping bulletin without content_hash: %s",
                    entry.get("source_url"),
                )
                skipped += 1
                continue
            cached = load_cached_result(classifier.name, classifier.version, content_hash)
            if cached is not None:
                cached_results[entry["source_url"]] = cached
                cache_hits += 1
            else:
                pending.append(entry)

        # Pass 2: run the classifier on cache misses, with bounded concurrency.
        for outcome in iter_extraction_outcomes(
            pending, conn, classifier.extract, concurrency=concurrency,
        ):
            if outcome.skipped:
                skipped += 1
                continue
            if outcome.extracted is None:
                errors.append(
                    {
                        "source_url": str(outcome.entry.get("source_url")),
                        "error": repr(outcome.error),
                    }
                )
                continue
            store_cached_result(
                classifier.name,
                classifier.version,
                outcome.entry["content_hash"],
                outcome.extracted,
            )
            cached_results[outcome.entry["source_url"]] = outcome.extracted
            cache_misses += 1
    finally:
        conn.close()

    # Rebuild events.json from the (now-current) cache for every served bulletin.
    events: list[dict[str, Any]] = []
    served_bulletins: list[dict[str, Any]] = []
    for entry in candidates:
        result = cached_results.get(entry["source_url"])
        if result is None:
            continue
        rows = flatten_extracted_events(entry, result)
        events.extend(rows)
        served_bulletins.append(
            {
                "bulletin_source_url": entry["source_url"],
                "pdf_path": entry.get("pdf_path")
                if isinstance(entry.get("pdf_path"), str)
                else None,
                "parish_slug": entry.get("parish_slug")
                if isinstance(entry.get("parish_slug"), str)
                else None,
                "published_date": (
                    entry.get("published_date")
                    if isinstance(entry.get("published_date"), str)
                    else None
                ),
                "event_count": len(rows),
                "wrong_bulletin": bool(result.get("wrong_bulletin")),
            }
        )

    save_json_list(events_path(classifier.name), events)
    save_json_list(bulletins_path(classifier.name), served_bulletins)

    summary = {
        "classifier": classifier.name,
        "classifier_version": classifier.version,
        "ran_at": utc_now_iso(),
        "bulletins_total": len(candidates),
        "bulletins_served": len(cached_results),
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
        "skipped": skipped,
        "errors": errors,
        "events_written": len(events),
        "wall_seconds": round(time.monotonic() - started, 3),
    }

    summary_path = run_summary_path(classifier.name)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    LOGGER.info("Extract run finished: %s", summary)
    return summary


def _empty_summary(classifier: Classifier) -> dict[str, Any]:
    return {
        "classifier": classifier.name,
        "classifier_version": classifier.version,
        "ran_at": utc_now_iso(),
        "bulletins_total": 0,
        "bulletins_served": 0,
        "cache_hits": 0,
        "cache_misses": 0,
        "skipped": 0,
        "errors": [],
        "events_written": 0,
        "wall_seconds": 0.0,
    }
