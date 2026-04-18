from pdf_extract.schedule_extraction import reconstruct_events


def test_normalize_weekly_schedule() -> None:
    """Weekly schedule entries are reconstructed as kind=weekly, cancelled=False."""
    data = {
        "weekly_schedule": {
            "masses": [
                {
                    "church_slug": "st-mary",
                    "day_of_week": "Sunday",
                    "start_time": "9:00 AM",
                    "page_number": 1,
                },
            ],
        },
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": False,
    }
    result = reconstruct_events(data)
    assert len(result["events"]) == 1
    assert result["events"][0]["church_slug"] == "st-mary"
    assert result["events"][0]["type"] == "mass"
    assert result["events"][0]["kind"] == "weekly"
    assert result["events"][0]["day_of_week"] == "Sunday"
    assert result["events"][0]["date"] is None
    assert result["events"][0]["start_time"] == "9:00 AM"
    assert result["events"][0]["cancelled"] is False
    assert result["events"][0]["page_number"] == 1
    assert result["events"][0]["note"] is None
    assert result["church_list_needs_review"] is False
    assert result["published_date"] is None
    assert result["wrong_bulletin"] is False


def test_normalize_single_events() -> None:
    """Single events are reconstructed as kind=specific_date, cancelled=False."""
    data = {
        "weekly_schedule": {"masses": [], "confessions": [], "adorations": []},
        "single_events": {
            "masses": [
                {"church_slug": "st-john", "date": "2026-03-16", "start_time": "10:00 AM"},
            ],
            "confessions": [],
            "adorations": [],
        },
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": False,
    }
    result = reconstruct_events(data)
    assert len(result["events"]) == 1
    assert result["events"][0]["church_slug"] == "st-john"
    assert result["events"][0]["type"] == "mass"
    assert result["events"][0]["kind"] == "specific_date"
    assert result["events"][0]["day_of_week"] is None
    assert result["events"][0]["date"] == "2026-03-16"
    assert result["events"][0]["cancelled"] is False


def test_normalize_cancellations() -> None:
    """Cancellations are reconstructed as kind=specific_date, cancelled=True."""
    data = {
        "weekly_schedule": {"masses": [], "confessions": [], "adorations": []},
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {
            "masses": [
                {"church_slug": "st-mary", "date": "2026-03-16", "start_time": "8:00am"},
            ],
            "confessions": [],
            "adorations": [],
        },
        "church_list_needs_review": False,
    }
    result = reconstruct_events(data)
    assert len(result["events"]) == 1
    assert result["events"][0]["church_slug"] == "st-mary"
    assert result["events"][0]["cancelled"] is True
    assert result["events"][0]["kind"] == "specific_date"
    assert result["events"][0]["date"] == "2026-03-16"


def test_normalize_combined() -> None:
    """Weekly, single, and cancellation entries are all reconstructed."""
    data = {
        "weekly_schedule": {
            "masses": [{"church_slug": "st-mary", "day_of_week": "Sunday", "start_time": "9:00 AM"}],
            "confessions": [
                {
                    "church_slug": "st-mary",
                    "day_of_week": "Saturday",
                    "start_time": "3:00 PM",
                    "end_time": "4:00 PM",
                },
            ],
            "adorations": [],
        },
        "single_events": {
            "masses": [{"church_slug": "st-mary", "date": "2026-12-25", "start_time": "midnight"}],
            "confessions": [],
            "adorations": [],
        },
        "cancellations": {
            "masses": [{"church_slug": "st-mary", "date": "2026-03-16", "start_time": "8:00am"}],
            "confessions": [],
            "adorations": [],
        },
        "church_list_needs_review": False,
    }
    result = reconstruct_events(data)
    assert len(result["events"]) == 4

    weekly_mass = next(e for e in result["events"] if e["kind"] == "weekly" and e["type"] == "mass")
    assert weekly_mass["day_of_week"] == "Sunday" and weekly_mass["cancelled"] is False

    weekly_confession = next(
        e for e in result["events"] if e["kind"] == "weekly" and e["type"] == "confession"
    )
    assert weekly_confession["end_time"] == "4:00 PM"

    single_mass = next(
        e for e in result["events"] if e["kind"] == "specific_date" and e["date"] == "2026-12-25"
    )
    assert single_mass["cancelled"] is False

    cancelled = next(e for e in result["events"] if e["cancelled"])
    assert cancelled["date"] == "2026-03-16" and cancelled["start_time"] == "8:00am"


def test_normalize_filters_invalid_entries() -> None:
    """Invalid entries (empty church_slug, missing required fields) are skipped."""
    data = {
        "weekly_schedule": {
            "masses": [
                {"church_slug": "", "day_of_week": "Saturday", "start_time": "5:00 PM"},
                {"church_slug": "st-john", "day_of_week": "Sunday", "start_time": "10:00 AM"},
            ],
        },
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": False,
    }
    result = reconstruct_events(data)
    assert len(result["events"]) == 1
    assert result["events"][0]["church_slug"] == "st-john"


def test_normalize_church_list_needs_review() -> None:
    data = {
        "weekly_schedule": {"masses": [], "confessions": [], "adorations": []},
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": True,
    }
    result = reconstruct_events(data)
    assert result["church_list_needs_review"] is True


def test_normalize_empty_payload() -> None:
    result = reconstruct_events({})
    assert result["events"] == []
    assert result["church_list_needs_review"] is False


def test_normalize_events_without_page_fields() -> None:
    """Events without page_number still work (backward compat)."""
    data = {
        "weekly_schedule": {
            "masses": [
                {"church_slug": "st-mary", "day_of_week": "Sunday", "start_time": "9:00 AM"},
            ],
        },
    }
    result = reconstruct_events(data)
    assert len(result["events"]) == 1
    assert result["events"][0]["page_number"] is None


def test_reconstruct_events_malformed_sections() -> None:
    """Malformed or missing sections are handled gracefully."""
    result = reconstruct_events({"weekly_schedule": None, "single_events": "not-a-dict"})
    assert result["events"] == []
    assert result["church_list_needs_review"] is False
    assert result["published_date"] is None
    assert result["wrong_bulletin"] is False


def test_normalize_event_notes() -> None:
    """Notes on weekly and specific-date slots are forwarded; whitespace/empty are dropped."""
    data = {
        "weekly_schedule": {
            "masses": [
                {
                    "church_slug": "st-mary",
                    "day_of_week": "Sunday",
                    "start_time": "11:00 AM",
                    "note": "  Spanish  ",
                },
                {
                    "church_slug": "st-mary",
                    "day_of_week": "Monday",
                    "start_time": "8:00 AM",
                    "note": "",
                },
            ],
        },
        "single_events": {
            "masses": [
                {
                    "church_slug": "st-mary",
                    "date": "2026-12-25",
                    "start_time": "midnight",
                    "note": "Latin (TLM)",
                },
            ],
            "confessions": [],
            "adorations": [],
        },
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
    }
    result = reconstruct_events(data)
    sunday = next(e for e in result["events"] if e["day_of_week"] == "Sunday")
    monday = next(e for e in result["events"] if e["day_of_week"] == "Monday")
    christmas = next(e for e in result["events"] if e["date"] == "2026-12-25")
    assert sunday["note"] == "Spanish"
    assert monday["note"] is None
    assert christmas["note"] == "Latin (TLM)"


def test_normalize_published_date_and_wrong_bulletin() -> None:
    """Top-level published_date and wrong_bulletin flags are surfaced."""
    data = {
        "weekly_schedule": {"masses": [], "confessions": [], "adorations": []},
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "published_date": "2026-04-12",
        "wrong_bulletin": True,
    }
    result = reconstruct_events(data)
    assert result["published_date"] == "2026-04-12"
    assert result["wrong_bulletin"] is True


def test_normalize_published_date_rejects_invalid() -> None:
    """Non-ISO published_date strings are coerced to None."""
    for raw in ["April 12, 2026", "", "   ", None, 12345]:
        result = reconstruct_events({"published_date": raw})
        assert result["published_date"] is None
