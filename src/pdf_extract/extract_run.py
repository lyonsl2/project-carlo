"""Experimental classifier runner: runs a registered classifier against the
fetched bulletin corpus and writes its outputs to data/runs/<classifier>/.

Independent of the production process.py path:
- does not consult or update the `processed_at` field in metadata.json
- does not write data/events.json
- does not touch the SQLite parish_events.db beyond reads

Caching: each classifier output is keyed by (classifier name + version,
bulletin content_hash). A cache hit means zero classifier calls on re-run.
"""

from __future__ import annotations

import json
import logging
import time
from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import Any

from pdf_extract.classifiers import Classifier, get_classifier
from pdf_extract.storage import (
    BULLETINS_METADATA_PATH,
    DATA_DIR,
    BulletinWorkItem,
    connect_db,
    get_parish_by_name,
    load_bulletin_work_item,
    load_json_list,
    save_json_list,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)

RUNS_DIR = DATA_DIR / "runs"


# ── On-disk layout ──────────────────────────────────────────────────────────
def run_dir(classifier_name: str) -> Path:
    return RUNS_DIR / classifier_name


def _cache_version_component(classifier_version: str) -> str:
    raw = classifier_version.strip() or "unknown"
    readable = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in raw)
    digest = sha256(raw.encode("utf-8")).hexdigest()[:12]
    return f"{readable[:80]}-{digest}"


def cache_path(classifier_name: str, classifier_version: str, content_hash: str) -> Path:
    return (
        run_dir(classifier_name)
        / "cache"
        / _cache_version_component(classifier_version)
        / f"{content_hash}.json"
    )


def events_path(classifier_name: str) -> Path:
    return run_dir(classifier_name) / "events.json"


def bulletins_path(classifier_name: str) -> Path:
    return run_dir(classifier_name) / "bulletins.json"


def run_summary_path(classifier_name: str) -> Path:
    return run_dir(classifier_name) / "run.json"


# ── Latest-per-parish (mirror of process.py) ────────────────────────────────
def _latest_per_parish(metadata: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_parish: dict[str, tuple[tuple[str, str, int], dict[str, Any]]] = {}
    for idx, entry in enumerate(metadata):
        parish_slug = entry.get("parish_slug")
        if not isinstance(parish_slug, str):
            continue
        fetched_at = str(entry.get("fetched_at") or "")
        rank = (fetched_at, str(entry.get("published_date") or ""), idx)
        current = latest_by_parish.get(parish_slug)
        if current is None or rank > current[0]:
            latest_by_parish[parish_slug] = (rank, entry)
    return [item[1] for item in latest_by_parish.values()]


# ── Cache I/O ───────────────────────────────────────────────────────────────
def _load_cached(
    classifier_name: str, classifier_version: str, content_hash: str
) -> dict[str, Any] | None:
    path = cache_path(classifier_name, classifier_version, content_hash)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        LOGGER.warning("Discarding unreadable cache entry %s", path, exc_info=True)
        return None


def _store_cached(
    classifier_name: str, classifier_version: str, content_hash: str, payload: dict[str, Any]
) -> None:
    path = cache_path(classifier_name, classifier_version, content_hash)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ── Flatten classifier output to events.json rows ───────────────────────────
def _flatten(entry: dict[str, Any], extracted: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert one classifier result into events.json rows (same shape as process.py)."""
    if extracted.get("wrong_bulletin"):
        return []

    out: list[dict[str, Any]] = []
    for ev in extracted.get("events", []):
        if not isinstance(ev, dict):
            continue
        church_slug = ev.get("church_slug")
        if not isinstance(church_slug, str):
            continue

        note_raw = ev.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None

        out.append(
            {
                "church_slug": church_slug,
                "bulletin_source_url": entry["source_url"],
                "event_type": str(ev.get("type", "")),
                "event_kind": str(ev.get("kind", "")),
                "day_of_week": ev.get("day_of_week")
                if isinstance(ev.get("day_of_week"), str)
                else None,
                "date": ev.get("date") if isinstance(ev.get("date"), str) else None,
                "start_time": str(ev.get("start_time", "")),
                "end_time": ev.get("end_time") if isinstance(ev.get("end_time"), str) else None,
                "cancelled": bool(ev.get("cancelled", False)),
                "page_number": ev.get("page_number")
                if isinstance(ev.get("page_number"), int)
                else None,
                "note": note,
            }
        )
    return out


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
    candidates = _latest_per_parish(candidates)

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
            cached = _load_cached(classifier.name, classifier.version, content_hash)
            if cached is not None:
                cached_results[entry["source_url"]] = cached
                cache_hits += 1
            else:
                pending.append(entry)

        # Pass 2: run the classifier on cache misses, with bounded concurrency.
        today = date.today()
        max_workers = max(1, concurrency)
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures: dict[Any, BulletinWorkItem] = {}

            def consume(fut) -> None:
                nonlocal cache_misses
                item = futures.pop(fut)
                try:
                    extracted = fut.result()
                except Exception as exc:
                    LOGGER.warning(
                        "Classifier %s failed for %s",
                        classifier.name,
                        item.entry.get("source_url"),
                        exc_info=True,
                    )
                    errors.append(
                        {
                            "source_url": str(item.entry.get("source_url")),
                            "error": repr(exc),
                        }
                    )
                    return
                _store_cached(
                    classifier.name,
                    classifier.version,
                    item.entry["content_hash"],
                    extracted,
                )
                cached_results[item.entry["source_url"]] = extracted
                cache_misses += 1

            for entry in pending:
                prepared = load_bulletin_work_item(entry, conn)
                if prepared is None:
                    skipped += 1
                    continue
                fut = pool.submit(
                    classifier.extract,
                    prepared.pdf_bytes,
                    churches=prepared.church_list,
                    today=today,
                )
                futures[fut] = prepared
                if len(futures) >= max_workers:
                    consume(next(as_completed(futures)))

            while futures:
                consume(next(as_completed(futures)))
    finally:
        conn.close()

    # Rebuild events.json from the (now-current) cache for every served bulletin.
    events: list[dict[str, Any]] = []
    served_bulletins: list[dict[str, Any]] = []
    for entry in candidates:
        result = cached_results.get(entry["source_url"])
        if result is None:
            continue
        rows = _flatten(entry, result)
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
