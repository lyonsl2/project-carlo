"""Tests for time parsing."""

from pdf_extract.db import _normalize_event_date, _time_to_minutes


def test_time_to_minutes_canonical() -> None:
    assert _time_to_minutes("8:00 AM") == 480
    assert _time_to_minutes("5:30 PM") == 1050
    assert _time_to_minutes("12:00 AM") == 0
    assert _time_to_minutes("12:00 PM") == 720
    assert _time_to_minutes("12:15 PM") == 735
    assert _time_to_minutes("11:59 PM") == 1439


def test_time_to_minutes_lowercase() -> None:
    assert _time_to_minutes("8:00am") == 480
    assert _time_to_minutes("5:30pm") == 1050
    assert _time_to_minutes("12:00am") == 0
    assert _time_to_minutes("12:00pm") == 720


def test_time_to_minutes_a_m_p_m() -> None:
    assert _time_to_minutes("8:00 a.m.") == 480
    assert _time_to_minutes("5:30 p.m.") == 1050
    assert _time_to_minutes("12:00 a.m.") == 0
    assert _time_to_minutes("12:00 p.m.") == 720


def test_time_to_minutes_midnight_noon() -> None:
    assert _time_to_minutes("midnight") == 0
    assert _time_to_minutes("noon") == 720


def test_time_to_minutes_24h() -> None:
    assert _time_to_minutes("08:00") == 480
    assert _time_to_minutes("17:30") == 1050
    assert _time_to_minutes("00:00") == 0
    assert _time_to_minutes("12:00") == 720


def test_time_to_minutes_null_empty() -> None:
    assert _time_to_minutes(None) is None
    assert _time_to_minutes("") is None
    assert _time_to_minutes("   ") is None


def test_normalize_event_date_accepts_iso() -> None:
    assert _normalize_event_date("2026-04-15") == "2026-04-15"


def test_normalize_event_date_converts_textual_month() -> None:
    assert _normalize_event_date("April 15, 2026") == "2026-04-15"
    assert _normalize_event_date("Apr 5, 2026") == "2026-04-05"


def test_normalize_event_date_converts_numeric_forms() -> None:
    assert _normalize_event_date("04/15/2026") == "2026-04-15"
    assert _normalize_event_date("04/15/26") == "2026-04-15"


def test_normalize_event_date_rejects_invalid() -> None:
    assert _normalize_event_date("not-a-date") is None
    assert _normalize_event_date("2026-13-99") is None

