"""Compare metrics: exact tuple match and Jaccard math."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pdf_extract import compare, extract_run


def _ev(**overrides):
    base = {
        "church_slug": "st-mary",
        "bulletin_source_url": "https://example.org/b.pdf",
        "event_type": "mass",
        "event_kind": "weekly",
        "day_of_week": "Sunday",
        "date": None,
        "start_time": "9:00 AM",
        "end_time": None,
        "cancelled": False,
        "page_number": 1,
        "note": None,
    }
    base.update(overrides)
    return base


def test_event_key_ignores_note_and_page_number():
    a = _ev(note="Latin", page_number=2)
    b = _ev(note=None, page_number=99)
    assert compare.event_key(a) == compare.event_key(b)


def test_event_key_distinguishes_start_time():
    a = _ev(start_time="9:00 AM")
    b = _ev(start_time="9:05 AM")
    assert compare.event_key(a) != compare.event_key(b)


def _write_run(tmp_path: Path, name: str, events: list[dict]) -> None:
    run_dir = tmp_path / "runs" / name
    (run_dir / "cache").mkdir(parents=True, exist_ok=True)
    (run_dir / "events.json").write_text(
        json.dumps(events, indent=2) + "\n", encoding="utf-8",
    )


def _write_metadata(tmp_path: Path, rows: list[dict]) -> None:
    (tmp_path / "metadata.json").write_text(
        json.dumps(rows, indent=2) + "\n", encoding="utf-8",
    )


@pytest.fixture
def patched_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(extract_run, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(compare, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(compare, "COMPARE_DIR", tmp_path / "runs" / "compare")
    monkeypatch.setattr(compare, "BULLETINS_METADATA_PATH", tmp_path / "metadata.json")
    _write_metadata(tmp_path, [])
    return tmp_path


def test_pairwise_full_agreement(patched_runs):
    tmp = patched_runs
    events = [_ev(start_time="9:00 AM"), _ev(start_time="11:00 AM")]
    _write_run(tmp, "a", events)
    _write_run(tmp, "b", list(events))

    report = compare.compare(["a", "b"], out_path=tmp / "report.json")
    pair = report["pairwise"][0]
    assert pair["events_in_both"] == 2
    assert pair["events_in_union"] == 2
    assert pair["micro_jaccard"] == 1.0
    assert pair["mean_jaccard"] == 1.0


def test_pairwise_partial_agreement_jaccard(patched_runs):
    tmp = patched_runs
    a_events = [
        _ev(start_time="9:00 AM"),
        _ev(start_time="11:00 AM"),
        _ev(start_time="5:00 PM"),
    ]
    b_events = [
        _ev(start_time="9:00 AM"),     # match
        _ev(start_time="11:30 AM"),    # disagree (a had 11:00)
        _ev(start_time="5:00 PM"),     # match
    ]
    _write_run(tmp, "a", a_events)
    _write_run(tmp, "b", b_events)

    report = compare.compare(["a", "b"], out_path=tmp / "report.json")
    pair = report["pairwise"][0]
    # Intersection: 9:00 AM, 5:00 PM. Union: 9:00, 11:00, 5:00, 11:30 = 4.
    assert pair["events_in_both"] == 2
    assert pair["events_in_union"] == 4
    assert pair["micro_jaccard"] == 0.5


def test_pairwise_details_show_same_and_model_differences(patched_runs):
    tmp = patched_runs
    source_url = "https://example.org/b.pdf"
    _write_metadata(tmp, [{
        "source_url": source_url,
        "pdf_path": "data/bulletins/example.pdf",
        "parish_slug": "st-mary-parish",
        "published_date": "2026-05-03",
    }])
    a_events = [
        _ev(start_time="9:00 AM", page_number=1, note="A note"),
        _ev(start_time="11:00 AM"),
    ]
    b_events = [
        _ev(start_time="9:00 AM", page_number=2, note="B note"),
        _ev(start_time="11:30 AM"),
    ]
    _write_run(tmp, "a", a_events)
    _write_run(tmp, "b", b_events)

    report = compare.compare(["a", "b"], out_path=tmp / "report.json")
    detail = report["pairwise"][0]["per_bulletin"][0]

    assert detail["bulletin_source_url"] == source_url
    assert detail["pdf_path"] == "data/bulletins/example.pdf"
    assert detail["parish_slug"] == "st-mary-parish"
    assert detail["published_date"] == "2026-05-03"
    assert detail["same_count"] == 1
    assert detail["only_in_a_count"] == 1
    assert detail["only_in_b_count"] == 1
    assert detail["jaccard"] == 0.3333
    assert detail["same"][0]["a"]["note"] == "A note"
    assert detail["same"][0]["b"]["note"] == "B note"
    assert detail["only_in_a"][0]["start_time"] == "11:00 AM"
    assert detail["only_in_b"][0]["start_time"] == "11:30 AM"


def test_compare_writes_side_by_side_markdown(patched_runs):
    tmp = patched_runs
    source_url = "https://example.org/b.pdf"
    _write_metadata(tmp, [{
        "source_url": source_url,
        "pdf_path": "data/bulletins/example.pdf",
        "parish_slug": "st-mary-parish",
        "published_date": "2026-05-03",
    }])
    _write_run(tmp, "a", [_ev(start_time="9:00 AM")])
    _write_run(tmp, "b", [_ev(start_time="9:30 AM")])

    report = compare.compare(["a", "b"], out_path=tmp / "report.json")
    markdown_path = tmp / "report.md"
    markdown = markdown_path.read_text(encoding="utf-8")

    assert report["markdown_report_path"] == str(markdown_path)
    assert "# Classifier Compare" in markdown
    assert "Source URL: https://example.org/b.pdf" in markdown
    assert "Source PDF: `data/bulletins/example.pdf`" in markdown
    assert "**Only a**" in markdown
    assert "**Only b**" in markdown


def test_bulletins_only_in_each_classifier_are_counted(patched_runs):
    tmp = patched_runs
    _write_run(tmp, "a", [_ev(bulletin_source_url="https://example.org/a-only.pdf")])
    _write_run(tmp, "b", [_ev(bulletin_source_url="https://example.org/b-only.pdf")])

    report = compare.compare(["a", "b"], out_path=tmp / "report.json")
    pair = report["pairwise"][0]
    assert pair["bulletins_in_both"] == 0
    assert pair["bulletins_only_in_a"] == 1
    assert pair["bulletins_only_in_b"] == 1


def test_compare_requires_two_classifiers(patched_runs):
    tmp = patched_runs
    _write_run(tmp, "a", [_ev()])
    with pytest.raises(ValueError):
        compare.compare(["a"], out_path=tmp / "report.json")


def test_compare_missing_run_raises(patched_runs):
    tmp = patched_runs
    _write_run(tmp, "a", [_ev()])
    with pytest.raises(FileNotFoundError):
        compare.compare(["a", "missing"], out_path=tmp / "report.json")
