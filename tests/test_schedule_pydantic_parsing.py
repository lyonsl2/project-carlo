import json
from types import SimpleNamespace

from pdf_extract.schedule_extraction import extract_events, extract_verification


def _mock_gemini_response(monkeypatch, text: str) -> None:
    def _generate_content_with_backoff(*args, **kwargs):
        return SimpleNamespace(text=text)

    monkeypatch.setattr(
        "pdf_extract.schedule_extraction._generate_content_with_backoff",
        _generate_content_with_backoff,
    )
    monkeypatch.setattr(
        "pdf_extract.schedule_extraction.genai.Client",
        lambda: SimpleNamespace(),
    )


def test_extract_events_falls_back_on_validation_error(monkeypatch) -> None:
    """One invalid slot should not drop valid slots when Pydantic validation fails."""
    payload = {
        "weekly_schedule": {
            "masses": [
                {"church_slug": "", "day_of_week": "Saturday", "start_time": "5:00 PM"},
                {"church_slug": "st-john", "day_of_week": "Sunday", "start_time": "10:00 AM"},
            ],
            "confessions": [],
            "adorations": [],
        },
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": False,
    }
    _mock_gemini_response(monkeypatch, json.dumps(payload))

    result = extract_events(b"%PDF", churches=[{"name": "St John", "address": "1 Main"}])

    assert len(result["events"]) == 1
    assert result["events"][0]["church_slug"] == "st-john"


def test_extract_verification_falls_back_on_validation_error(monkeypatch) -> None:
    """Invalid status values are coerced to unverifiable via lenient fallback."""
    payload = {
        "existing_churches": [
            {
                "church_slug": "st-mary",
                "name_status": "maybe",
                "address_status": "verified",
                "slug_needs_review": False,
            },
        ],
        "new_churches": [],
    }
    _mock_gemini_response(monkeypatch, json.dumps(payload))

    result = extract_verification(b"%PDF", churches=[{"slug": "st-mary", "name": "St Mary", "address": "1 Main"}])

    assert len(result["existing_churches"]) == 1
    assert result["existing_churches"][0]["name_status"] == "unverifiable"
    assert result["existing_churches"][0]["address_status"] == "verified"


def test_extract_verification_uses_pydantic_on_valid_response(monkeypatch) -> None:
    payload = {
        "existing_churches": [
            {
                "church_slug": "st-mary",
                "name_status": "verified",
                "address_status": "verified",
                "slug_needs_review": False,
            },
        ],
        "new_churches": [
            {
                "name": "St Joseph",
                "slug": "st-joseph",
                "address": {"line1": "2 Oak St", "city": "Corning", "state": "NY", "postal_code": "14830"},
            },
        ],
    }
    _mock_gemini_response(monkeypatch, json.dumps(payload))

    result = extract_verification(b"%PDF", churches=[{"slug": "st-mary", "name": "St Mary", "address": "1 Main"}])

    assert result["existing_churches"][0]["name_status"] == "verified"
    assert result["new_churches"][0]["name"] == "St Joseph"
