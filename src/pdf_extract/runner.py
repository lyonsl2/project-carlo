"""Shared infrastructure for running bulletin classifiers over the fetched corpus.

Both the production process stage (process.py) and the experimental classifier
runner (extract_run.py) are thin orchestrations over the pieces here:

- latest-per-parish bulletin selection
- flattening classifier output into events.json rows
- an on-disk result cache keyed by (classifier name + version, bulletin
  content_hash) under data/runs/<classifier>/cache/
- a bounded-concurrency extraction driver
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date
from hashlib import sha256
from pathlib import Path
from typing import Any

from pdf_extract.storage import DATA_DIR, load_bulletin_work_item

LOGGER = logging.getLogger(__name__)

RUNS_DIR = DATA_DIR / "runs"


# ── Latest-per-parish bulletin selection ────────────────────────────────────
def latest_per_parish(metadata: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only the most recently fetched bulletin entry for each parish."""
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


# ── Flatten classifier output to events.json rows ───────────────────────────
def flatten_extracted_events(
    entry: dict[str, Any], extracted: dict[str, Any]
) -> list[dict[str, Any]]:
    """Convert one classifier result into events.json rows.

    Returns no rows when the classifier flagged the PDF as the wrong bulletin.
    """
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


# ── On-disk result cache ────────────────────────────────────────────────────
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


def load_cached_result(
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


def store_cached_result(
    classifier_name: str, classifier_version: str, content_hash: str, payload: dict[str, Any]
) -> None:
    path = cache_path(classifier_name, classifier_version, content_hash)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ── Bounded-concurrency extraction driver ───────────────────────────────────
ExtractFn = Callable[..., dict[str, Any]]
"""Classifier extract callable: (pdf_bytes, *, churches, today) -> extracted dict."""


@dataclass
class ExtractionOutcome:
    """Result of running a classifier on one bulletin metadata entry.

    Exactly one of the three shapes applies: `skipped` is True when the work
    item could not be prepared, `error` is set when the classifier raised, and
    `extracted` is set on success.
    """

    entry: dict[str, Any]
    extracted: dict[str, Any] | None = None
    error: Exception | None = None
    skipped: bool = False


def iter_extraction_outcomes(
    entries: list[dict[str, Any]],
    conn: sqlite3.Connection,
    extract: ExtractFn,
    *,
    concurrency: int = 5,
    today: date | None = None,
) -> Iterator[ExtractionOutcome]:
    """Run `extract` over bulletin entries, yielding outcomes in completion order.

    Work is prepared on the caller's thread (the sqlite connection must stay
    single-threaded), and only up to `concurrency` PDFs are resident/in-flight
    at once: some bulletins are large enough that preloading the whole corpus
    can exhaust memory before extraction starts.

    Classifier exceptions are caught and logged, never raised.
    """
    if today is None:
        today = date.today()
    max_workers = max(1, concurrency)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures: dict[Future[dict[str, Any]], dict[str, Any]] = {}

        def drain_one() -> ExtractionOutcome:
            fut = next(as_completed(futures))
            entry = futures.pop(fut)
            try:
                return ExtractionOutcome(entry=entry, extracted=fut.result())
            except Exception as exc:
                LOGGER.warning(
                    "Extraction failed for %s", entry.get("source_url"), exc_info=True,
                )
                return ExtractionOutcome(entry=entry, error=exc)

        for entry in entries:
            prepared = load_bulletin_work_item(entry, conn)
            if prepared is None:
                yield ExtractionOutcome(entry=entry, skipped=True)
                continue
            fut = pool.submit(
                extract, prepared.pdf_bytes, churches=prepared.church_list, today=today,
            )
            futures[fut] = entry
            if len(futures) >= max_workers:
                yield drain_one()

        while futures:
            yield drain_one()
