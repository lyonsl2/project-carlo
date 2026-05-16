"""Caching behavior of the experimental classifier runner."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from pdf_extract import extract_run
from pdf_extract.classifiers import REGISTRY
from pdf_extract.storage import SCHEMA_PATH, connect_db, save_json_list


def _setup_test_db(tmp_path: Path) -> Path:
    db_path = tmp_path / "parish_events.db"
    conn = connect_db(db_path)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.execute(
        """INSERT INTO parish(
            slug, name, homepage_url, bulletin_provider, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)""",
        (
            "test-parish",
            "Test Parish",
            "https://test.org",
            "ecatholic",
            None,
            "2026-01-01T00:00:00Z",
        ),
    )
    parish_id = conn.execute("SELECT id FROM parish WHERE slug = 'test-parish'").fetchone()["id"]
    conn.execute(
        "INSERT INTO church(parish_id, slug, name, address_line1, city, state, postal_code,"
        " created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            parish_id,
            "st-mary-anytown",
            "St. Mary",
            "123 Main St",
            "Anytown",
            "NY",
            "14000",
            "2026-01-01T00:00:00Z",
        ),
    )
    conn.commit()
    conn.close()
    return db_path


class _CountingClassifier:
    """Records every call so the test can assert cache hits skip the real call."""

    name = "counting"
    version = "v1"

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.call_count = 0

    def extract(self, pdf_bytes, *, churches, today: date):
        self.call_count += 1
        return self._payload


def _payload_one_event() -> dict[str, Any]:
    return {
        "events": [
            {
                "church_slug": "st-mary-anytown",
                "type": "mass",
                "kind": "weekly",
                "day_of_week": "Sunday",
                "date": None,
                "start_time": "9:00 AM",
                "end_time": None,
                "cancelled": False,
                "page_number": 1,
                "note": None,
            }
        ],
        "church_list_needs_review": False,
        "published_date": None,
        "wrong_bulletin": False,
    }


def _patch_paths(monkeypatch, tmp_path: Path, classifier: _CountingClassifier) -> None:
    monkeypatch.setattr(extract_run, "BULLETINS_METADATA_PATH", tmp_path / "metadata.json")
    monkeypatch.setattr(extract_run, "DATA_DIR", tmp_path)
    monkeypatch.setattr(extract_run, "RUNS_DIR", tmp_path / "runs")
    # Skip the pypdf truncation helper for these stub PDFs.
    monkeypatch.setattr("pdf_extract.storage.ensure_truncated_pdf", lambda path, **kwargs: path)
    monkeypatch.setitem(REGISTRY, classifier.name, lambda: classifier)


@pytest.fixture
def seeded_run(tmp_path, monkeypatch):
    """A test harness with one bulletin in metadata and a counting classifier."""
    db_path = _setup_test_db(tmp_path)
    monkeypatch.setattr(extract_run, "connect_db", lambda: connect_db(db_path))

    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"fake")

    save_json_list(
        tmp_path / "metadata.json",
        [
            {
                "parish_slug": "test-parish",
                "source_url": "https://example.org/parsed.pdf",
                "pdf_path": str(pdf_path),
                "content_hash": "hash-abc",
                "fetched_at": "2026-01-01T00:00:00Z",
                "processed_at": None,
                "published_date": None,
            }
        ],
    )

    classifier = _CountingClassifier(_payload_one_event())
    _patch_paths(monkeypatch, tmp_path, classifier)
    return tmp_path, classifier


def test_first_run_calls_classifier_and_writes_outputs(seeded_run):
    tmp_path, classifier = seeded_run

    summary = extract_run.run(classifier_name="counting", concurrency=1)

    assert classifier.call_count == 1
    assert summary["cache_hits"] == 0
    assert summary["cache_misses"] == 1
    assert summary["events_written"] == 1

    cache_file = extract_run.cache_path("counting", "v1", "hash-abc")
    assert cache_file.exists()
    cached = json.loads(cache_file.read_text(encoding="utf-8"))
    assert cached["events"][0]["church_slug"] == "st-mary-anytown"

    bulletins_file = extract_run.bulletins_path("counting")
    bulletins = json.loads(bulletins_file.read_text(encoding="utf-8"))
    assert bulletins == [
        {
            "bulletin_source_url": "https://example.org/parsed.pdf",
            "pdf_path": str(tmp_path / "sample.pdf"),
            "parish_slug": "test-parish",
            "published_date": None,
            "event_count": 1,
            "wrong_bulletin": False,
        }
    ]

    events_file = tmp_path / "runs" / "counting" / "events.json"
    events = json.loads(events_file.read_text(encoding="utf-8"))
    assert events[0]["bulletin_source_url"] == "https://example.org/parsed.pdf"
    assert events[0]["event_type"] == "mass"


def test_second_run_serves_from_cache_without_calling_classifier(seeded_run):
    _, classifier = seeded_run

    extract_run.run(classifier_name="counting", concurrency=1)
    assert classifier.call_count == 1

    summary = extract_run.run(classifier_name="counting", concurrency=1)
    assert classifier.call_count == 1, "cache hit should skip classifier"
    assert summary["cache_hits"] == 1
    assert summary["cache_misses"] == 0
    assert summary["events_written"] == 1


def test_cache_miss_after_classifier_version_changes(seeded_run):
    _, classifier = seeded_run

    extract_run.run(classifier_name="counting", concurrency=1)
    assert classifier.call_count == 1

    classifier.version = "v2"
    summary = extract_run.run(classifier_name="counting", concurrency=1)

    assert classifier.call_count == 2
    assert summary["cache_hits"] == 0
    assert summary["cache_misses"] == 1
    assert extract_run.cache_path("counting", "v2", "hash-abc").exists()


def test_run_does_not_touch_metadata_processed_at(seeded_run):
    tmp_path, _ = seeded_run

    extract_run.run(classifier_name="counting", concurrency=1)

    metadata = json.loads((tmp_path / "metadata.json").read_text(encoding="utf-8"))
    assert metadata[0]["processed_at"] is None, (
        "experimental runs must not mark bulletins as processed for the prod path"
    )


def test_unknown_classifier_raises(seeded_run):
    with pytest.raises(KeyError):
        extract_run.run(classifier_name="nope")
