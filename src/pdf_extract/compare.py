"""Pairwise agreement metrics over experimental classifier runs.

Reads data/runs/<name>/events.json for each requested classifier and computes
exact-tuple-match agreement, broken down per-bulletin and aggregated. Also
surfaces per-classifier latency and cache stats from data/runs/<name>/run.json.

The match-key extraction is exposed as `event_key()` so the same matcher can
score against ground truth once labels exist.
"""

from __future__ import annotations

import itertools
import json
import logging
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from pdf_extract.extract_run import RUNS_DIR, events_path, run_summary_path
from pdf_extract.storage import utc_now_iso

LOGGER = logging.getLogger(__name__)

COMPARE_DIR = RUNS_DIR / "compare"

EventKey = tuple[str, str, str, str | None, str | None, str, str | None, bool]


def event_key(event: dict[str, Any]) -> EventKey:
    """Exact-match identity for an event row.

    Two events from different classifiers are considered to agree iff their
    `event_key()` tuples are equal. Notes and page numbers are excluded — they
    are commentary, not identity.
    """
    return (
        str(event.get("church_slug", "")),
        str(event.get("event_type", "")),
        str(event.get("event_kind", "")),
        event.get("day_of_week") if isinstance(event.get("day_of_week"), str) else None,
        event.get("date") if isinstance(event.get("date"), str) else None,
        str(event.get("start_time", "")),
        event.get("end_time") if isinstance(event.get("end_time"), str) else None,
        bool(event.get("cancelled", False)),
    )


def _load_run(classifier_name: str) -> tuple[dict[str, set[EventKey]], dict[str, Any]]:
    """Return (events grouped by bulletin_source_url, run.json summary if present)."""
    ev_path = events_path(classifier_name)
    if not ev_path.exists():
        raise FileNotFoundError(
            f"No events.json for classifier {classifier_name!r} at {ev_path}. "
            f"Run `pnpm extract --classifier {classifier_name}` first."
        )
    rows = json.loads(ev_path.read_text(encoding="utf-8"))

    grouped: dict[str, set[EventKey]] = defaultdict(set)
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = row.get("bulletin_source_url")
        if not isinstance(url, str):
            continue
        grouped[url].add(event_key(row))

    summary_path = run_summary_path(classifier_name)
    summary: dict[str, Any] = {}
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            LOGGER.warning("Could not parse %s; ignoring", summary_path, exc_info=True)

    return grouped, summary


def _pairwise_metrics(
    name_a: str,
    grouped_a: dict[str, set[EventKey]],
    name_b: str,
    grouped_b: dict[str, set[EventKey]],
) -> dict[str, Any]:
    common_urls = sorted(set(grouped_a) & set(grouped_b))
    only_a_urls = sorted(set(grouped_a) - set(grouped_b))
    only_b_urls = sorted(set(grouped_b) - set(grouped_a))

    total_intersect = 0
    total_union = 0
    total_a = 0
    total_b = 0
    per_bulletin_jaccards: list[float] = []
    one_sided_zero: list[dict[str, Any]] = []  # one classifier returned 0 events

    for url in common_urls:
        a_set = grouped_a[url]
        b_set = grouped_b[url]
        intersect = len(a_set & b_set)
        union = len(a_set | b_set)
        total_intersect += intersect
        total_union += union
        total_a += len(a_set)
        total_b += len(b_set)
        if union:
            per_bulletin_jaccards.append(intersect / union)
        else:
            per_bulletin_jaccards.append(1.0)  # both empty: agree trivially
        if (len(a_set) == 0) != (len(b_set) == 0):
            one_sided_zero.append({
                "bulletin_source_url": url,
                f"{name_a}_event_count": len(a_set),
                f"{name_b}_event_count": len(b_set),
            })

    micro_jaccard = (total_intersect / total_union) if total_union else None
    mean_jaccard = (
        round(statistics.fmean(per_bulletin_jaccards), 4)
        if per_bulletin_jaccards else None
    )
    median_jaccard = (
        round(statistics.median(per_bulletin_jaccards), 4)
        if per_bulletin_jaccards else None
    )

    return {
        "classifier_a": name_a,
        "classifier_b": name_b,
        "bulletins_in_both": len(common_urls),
        "bulletins_only_in_a": len(only_a_urls),
        "bulletins_only_in_b": len(only_b_urls),
        f"events_total_{name_a}": total_a,
        f"events_total_{name_b}": total_b,
        "events_in_both": total_intersect,
        "events_in_union": total_union,
        "micro_jaccard": round(micro_jaccard, 4) if micro_jaccard is not None else None,
        "mean_jaccard": mean_jaccard,
        "median_jaccard": median_jaccard,
        "one_sided_zero_event_bulletins": one_sided_zero,
    }


def _classifier_stats(
    name: str, grouped: dict[str, set[EventKey]], summary: dict[str, Any]
) -> dict[str, Any]:
    counts = [len(s) for s in grouped.values()]
    return {
        "classifier": name,
        "version": summary.get("classifier_version"),
        "bulletins": len(grouped),
        "events_total": sum(counts),
        "events_per_bulletin_mean": round(statistics.fmean(counts), 2) if counts else 0.0,
        "events_per_bulletin_median": statistics.median(counts) if counts else 0,
        "events_per_bulletin_max": max(counts) if counts else 0,
        "cache_hits": summary.get("cache_hits"),
        "cache_misses": summary.get("cache_misses"),
        "wall_seconds": summary.get("wall_seconds"),
        "errors": len(summary.get("errors") or []),
    }


def compare(
    classifier_names: list[str],
    *,
    out_path: Path | None = None,
) -> dict[str, Any]:
    """Compute pairwise metrics across N classifier runs."""
    if len(classifier_names) < 2:
        raise ValueError("Need at least two classifiers to compare")

    runs = {name: _load_run(name) for name in classifier_names}

    per_classifier = [
        _classifier_stats(name, grouped, summary)
        for name, (grouped, summary) in runs.items()
    ]

    pairwise = [
        _pairwise_metrics(a, runs[a][0], b, runs[b][0])
        for a, b in itertools.combinations(classifier_names, 2)
    ]

    report = {
        "generated_at": utc_now_iso(),
        "classifiers": classifier_names,
        "per_classifier": per_classifier,
        "pairwise": pairwise,
    }

    if out_path is None:
        COMPARE_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%dT%H%M%S")
        out_path = COMPARE_DIR / f"compare_{ts}.json"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(format_markdown(report))
    print(f"\nFull report: {out_path}")

    return report


def format_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("## Per-classifier")
    lines.append("")
    lines.append("| Classifier | Version | Bulletins | Events | Mean/bulletin | Cache hits/misses | Wall (s) | Errors |")
    lines.append("|---|---|---:|---:|---:|---|---:|---:|")
    for c in report["per_classifier"]:
        cache = f"{c.get('cache_hits') or 0}/{c.get('cache_misses') or 0}"
        lines.append(
            f"| {c['classifier']} | {c.get('version') or ''} | {c['bulletins']} | {c['events_total']} | "
            f"{c['events_per_bulletin_mean']} | {cache} | {c.get('wall_seconds') or ''} | {c['errors']} |"
        )

    lines.append("")
    lines.append("## Pairwise agreement (exact tuple match)")
    lines.append("")
    lines.append("| A | B | Bulletins shared | Events ∩ | Events ∪ | Micro-Jaccard | Mean Jaccard | One-sided-zero |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|")
    for p in report["pairwise"]:
        lines.append(
            f"| {p['classifier_a']} | {p['classifier_b']} | {p['bulletins_in_both']} | "
            f"{p['events_in_both']} | {p['events_in_union']} | "
            f"{p['micro_jaccard']} | {p['mean_jaccard']} | {len(p['one_sided_zero_event_bulletins'])} |"
        )
    return "\n".join(lines)
