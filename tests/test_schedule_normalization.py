from pdf_extract.schedule_extraction import _normalize_payload


def test_normalize_new_shape() -> None:
    data = {
        "events": [
            {
                "church_slug": "st-mary",
                "type": "mass",
                "kind": "weekly",
                "day_of_week": "Sunday",
                "date": None,
                "start_time": "9:00 AM",
                "end_time": None,
                "cancelled": False,
            }
        ],
        "church_list_needs_review": False,
    }
    result = _normalize_payload(data)
    assert result["events"][0]["church_slug"] == "st-mary"
    assert "church_name" not in result["events"][0]
    assert result["church_list_needs_review"] is False


def test_normalize_filters_invalid_events() -> None:
    data = {
        "events": [
            {
                "church_slug": "",
                "type": "mass",
                "kind": "weekly",
                "day_of_week": "Saturday",
                "date": None,
                "start_time": "5:00 PM",
                "end_time": None,
                "cancelled": False,
            },
            {
                "church_slug": "st-john",
                "type": "mass",
                "kind": "weekly",
                "day_of_week": "Sunday",
                "date": None,
                "start_time": "10:00 AM",
                "end_time": None,
                "cancelled": False,
            },
        ],
        "church_list_needs_review": False,
    }
    result = _normalize_payload(data)
    assert len(result["events"]) == 1
    assert result["events"][0]["church_slug"] == "st-john"


def test_normalize_church_list_needs_review() -> None:
    data = {
        "events": [],
        "church_list_needs_review": True,
    }
    result = _normalize_payload(data)
    assert result["church_list_needs_review"] is True


def test_normalize_empty_payload() -> None:
    result = _normalize_payload({})
    assert result["events"] == []
    assert result["church_list_needs_review"] is False
