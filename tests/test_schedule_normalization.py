from pdf_extract.schedule_extraction import _normalize_payload


def test_normalize_new_shape() -> None:
    data = {
        "churches": [{"id": "c1", "name": "St. Mary", "address": "123 Main"}],
        "events": [
            {
                "church_id": "c1",
                "type": "mass",
                "kind": "weekly",
                "day_of_week": "Sunday",
                "date": None,
                "start_time": "9:00 AM",
                "end_time": None,
                "cancelled": False,
            }
        ],
    }
    result = _normalize_payload(data)
    assert result["churches"][0]["id"] == "c1"
    assert result["events"][0]["church_id"] == "c1"


def test_normalize_rejects_unknown_church_id() -> None:
    data = {
        "churches": [
            {
                "id": "c1",
                "name": "St. John",
                "address": "456 Oak",
            }
        ],
        "events": [
            {
                "church_id": "c999",
                "type": "mass",
                "kind": "weekly",
                "day_of_week": "Saturday",
                "date": None,
                "start_time": "5:00 PM",
                "end_time": None,
                "cancelled": False,
            }
        ],
    }
    result = _normalize_payload(data)
    assert result["churches"][0]["id"] == "c1"
    assert result["churches"][0]["name"] == "St. John"
    assert result["events"] == []
