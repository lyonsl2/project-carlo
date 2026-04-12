"""Tests for apply module: merging detect/verify results into CSVs."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from pdf_extract.apply import apply_detect_results, apply_geocode_results, apply_verify_results


@pytest.fixture()
def parishes_csv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "parishes.csv"
    path.write_text(
        "slug,name,website\n"
        "parish-a,Parish A,https://a.org\n"
        "parish-b,Parish B,https://b.org\n"
        "parish-c,Parish C,https://c.org\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("pdf_extract.apply.PARISHES_CSV_PATH", path)
    return path


@pytest.fixture()
def churches_csv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "churches.csv"
    path.write_text(
        "parish_id,slug,name,line1,line2,city,state,postal_code\n"
        "parish-a,church-1,Old Name,100 Main St,,Town,NY,14000\n"
        "parish-a,church-2,Church Two,200 Oak Ave,,Town,NY,14001\n"
        "parish-b,church-3,Church Three,300 Elm St,,City,NY,14002\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("pdf_extract.apply.CHURCHES_CSV_PATH", path)
    return path


@pytest.fixture()
def detect_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "detect_results.json"
    monkeypatch.setattr("pdf_extract.apply.DETECT_RESULTS_PATH", path)
    return path


@pytest.fixture()
def verify_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "verify_results.json"
    monkeypatch.setattr("pdf_extract.apply.VERIFY_RESULTS_PATH", path)
    return path


def _read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


class TestApplyDetectResults:
    def test_merges_results_into_csv(
        self, parishes_csv: Path, detect_json: Path,
    ) -> None:
        detect_json.write_text(json.dumps({
            "parish-a": {"bulletin_provider": "ecatholic", "provider_id": None},
            "parish-b": {"bulletin_provider": "parishes_online", "provider_id": "pb-id"},
        }), encoding="utf-8")

        stats = apply_detect_results()
        assert stats == {"updated": 2, "unchanged": 1}

        rows = _read_csv(parishes_csv)
        assert len(rows) == 3
        assert rows[0]["bulletin_provider"] == "ecatholic"
        assert rows[0]["provider_id"] == ""
        assert rows[1]["bulletin_provider"] == "parishes_online"
        assert rows[1]["provider_id"] == "pb-id"
        assert rows[2]["bulletin_provider"] == ""
        assert rows[2]["provider_id"] == ""

    def test_deletes_json_after_apply(
        self, parishes_csv: Path, detect_json: Path,
    ) -> None:
        detect_json.write_text(json.dumps({
            "parish-a": {"bulletin_provider": "ecatholic", "provider_id": None},
        }), encoding="utf-8")

        apply_detect_results()
        assert not detect_json.exists()

    def test_no_json_file(self, parishes_csv: Path, detect_json: Path) -> None:
        stats = apply_detect_results()
        assert stats == {"updated": 0, "unchanged": 0}

    def test_preserves_existing_csv_data(
        self, parishes_csv: Path, detect_json: Path,
    ) -> None:
        detect_json.write_text(json.dumps({
            "parish-a": {"bulletin_provider": "other", "provider_id": None},
        }), encoding="utf-8")

        apply_detect_results()
        rows = _read_csv(parishes_csv)
        assert rows[0]["name"] == "Parish A"
        assert rows[0]["website"] == "https://a.org"


class TestApplyVerifyResults:
    def test_applies_name_correction(
        self, churches_csv: Path, verify_json: Path,
    ) -> None:
        verify_json.write_text(json.dumps({
            "parish-a": {
                "existing_churches": [{
                    "church_slug": "church-1",
                    "name_status": "incorrect",
                    "address_status": "verified",
                    "corrected_name": "Corrected Name",
                    "corrected_address": None,
                }],
                "new_churches": [],
            },
        }), encoding="utf-8")

        stats = apply_verify_results()
        assert stats["corrections_applied"] == 1

        rows = _read_csv(churches_csv)
        assert rows[0]["name"] == "Corrected Name"
        assert rows[0]["name_verified"] == "true"
        assert rows[0]["address_verified"] == "true"

    def test_applies_address_correction(
        self, churches_csv: Path, verify_json: Path,
    ) -> None:
        verify_json.write_text(json.dumps({
            "parish-a": {
                "existing_churches": [{
                    "church_slug": "church-1",
                    "name_status": "verified",
                    "address_status": "incorrect",
                    "corrected_name": None,
                    "corrected_address": {
                        "line1": "999 New St",
                        "line2": "Suite B",
                        "city": "NewTown",
                        "state": "NY",
                        "postal_code": "14999",
                    },
                }],
                "new_churches": [],
            },
        }), encoding="utf-8")

        stats = apply_verify_results()
        assert stats["corrections_applied"] == 1

        rows = _read_csv(churches_csv)
        assert rows[0]["line1"] == "999 New St"
        assert rows[0]["line2"] == "Suite B"
        assert rows[0]["city"] == "NewTown"
        assert rows[0]["address_verified"] == "true"

    def test_sets_verification_flags(
        self, churches_csv: Path, verify_json: Path,
    ) -> None:
        verify_json.write_text(json.dumps({
            "parish-a": {
                "existing_churches": [
                    {
                        "church_slug": "church-1",
                        "name_status": "verified",
                        "address_status": "verified",
                    },
                    {
                        "church_slug": "church-2",
                        "name_status": "unverifiable",
                        "address_status": "unverifiable",
                    },
                ],
                "new_churches": [],
            },
        }), encoding="utf-8")

        apply_verify_results()
        rows = _read_csv(churches_csv)
        assert rows[0]["name_verified"] == "true"
        assert rows[0]["address_verified"] == "true"
        # unverifiable -> false (needs human review)
        assert rows[1]["name_verified"] == "false"
        assert rows[1]["address_verified"] == "false"

    def test_appends_new_churches(
        self, churches_csv: Path, verify_json: Path,
    ) -> None:
        verify_json.write_text(json.dumps({
            "parish-a": {
                "existing_churches": [],
                "new_churches": [{
                    "name": "New Church",
                    "slug": "new-church",
                    "address": {
                        "line1": "500 Pine Rd",
                        "line2": None,
                        "city": "Village",
                        "state": "NY",
                        "postal_code": "14500",
                    },
                }],
            },
        }), encoding="utf-8")

        stats = apply_verify_results()
        assert stats["new_churches_added"] == 1

        rows = _read_csv(churches_csv)
        assert len(rows) == 4
        new_row = rows[3]
        assert new_row["parish_id"] == "parish-a"
        assert new_row["slug"] == "new-church"
        assert new_row["name"] == "New Church"
        assert new_row["line1"] == "500 Pine Rd"

    def test_skips_duplicate_new_church(
        self, churches_csv: Path, verify_json: Path,
    ) -> None:
        verify_json.write_text(json.dumps({
            "parish-a": {
                "existing_churches": [],
                "new_churches": [{
                    "name": "Duplicate",
                    "slug": "church-1",
                    "address": None,
                }],
            },
        }), encoding="utf-8")

        stats = apply_verify_results()
        assert stats["new_churches_added"] == 0

        rows = _read_csv(churches_csv)
        assert len(rows) == 3

    def test_deletes_json_after_apply(
        self, churches_csv: Path, verify_json: Path,
    ) -> None:
        verify_json.write_text(json.dumps({
            "parish-a": {
                "existing_churches": [{
                    "church_slug": "church-1",
                    "name_status": "verified",
                    "address_status": "verified",
                }],
                "new_churches": [],
            },
        }), encoding="utf-8")

        apply_verify_results()
        assert not verify_json.exists()

    def test_no_json_file(self, churches_csv: Path, verify_json: Path) -> None:
        stats = apply_verify_results()
        assert stats == {"corrections_applied": 0, "new_churches_added": 0}


@pytest.fixture()
def geocode_churches_csv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "churches.csv"
    path.write_text(
        "parish_id,slug,name,line1,line2,city,state,postal_code,name_verified,address_verified\n"
        "parish-a,church-1,Church One,100 Main St,,Town,NY,14000,true,true\n"
        "parish-a,church-2,Church Two,200 Oak Ave,,Town,NY,14001,true,true\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("pdf_extract.apply.CHURCHES_CSV_PATH", path)
    return path


@pytest.fixture()
def geocode_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "geocode_results.json"
    monkeypatch.setattr("pdf_extract.apply.GEOCODE_RESULTS_PATH", path)
    return path


class TestApplyGeocodeResults:
    def test_merges_coordinates_into_csv(
        self, geocode_churches_csv: Path, geocode_json: Path,
    ) -> None:
        geocode_json.write_text(json.dumps([
            {
                "line1": "100 Main St", "line2": None,
                "city": "Town", "state": "NY", "postal_code": "14000",
                "latitude": 42.123, "longitude": -77.456,
            },
        ]), encoding="utf-8")

        stats = apply_geocode_results()
        assert stats == {"updated": 1}

        rows = _read_csv(geocode_churches_csv)
        assert rows[0]["latitude"] == "42.123"
        assert rows[0]["longitude"] == "-77.456"
        # Unmatched church keeps empty lat/lng
        assert rows[1]["latitude"] == ""
        assert rows[1]["longitude"] == ""

    def test_deletes_json_after_apply(
        self, geocode_churches_csv: Path, geocode_json: Path,
    ) -> None:
        geocode_json.write_text(json.dumps([
            {
                "line1": "100 Main St", "line2": None,
                "city": "Town", "state": "NY", "postal_code": "14000",
                "latitude": 42.0, "longitude": -77.0,
            },
        ]), encoding="utf-8")

        apply_geocode_results()
        assert not geocode_json.exists()

    def test_no_json_file(
        self, geocode_churches_csv: Path, geocode_json: Path,
    ) -> None:
        stats = apply_geocode_results()
        assert stats == {"updated": 0}

    def test_skips_invalid_coordinates(
        self, geocode_churches_csv: Path, geocode_json: Path,
    ) -> None:
        geocode_json.write_text(json.dumps([
            {
                "line1": "100 Main St", "line2": None,
                "city": "Town", "state": "NY", "postal_code": "14000",
                "latitude": 999, "longitude": -77.0,
            },
        ]), encoding="utf-8")

        stats = apply_geocode_results()
        assert stats == {"updated": 0}

        rows = _read_csv(geocode_churches_csv)
        assert rows[0]["latitude"] == ""
