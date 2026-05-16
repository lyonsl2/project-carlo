"""OpenAI classifier: verify request shape and result normalization."""

from __future__ import annotations

import base64
from datetime import date
from typing import Any

import pytest

from pdf_extract.classifiers import openai_gpt
from pdf_extract.classifiers.openai_gpt import OpenAIClassifier


class _FakeParsed:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def model_dump(self) -> dict[str, Any]:
        return self._payload


class _FakeResponse:
    def __init__(self, parsed: _FakeParsed | None) -> None:
        self.output_parsed = parsed


class _FakeResponses:
    def __init__(self, parsed: _FakeParsed | None) -> None:
        self._parsed = parsed
        self.last_kwargs: dict[str, Any] = {}
        self.call_count = 0

    def parse(self, **kwargs: Any) -> _FakeResponse:
        self.call_count += 1
        self.last_kwargs = kwargs
        return _FakeResponse(self._parsed)


class _FakeClient:
    def __init__(self, *, responses: _FakeResponses) -> None:
        self.responses = responses


def _install_fake(monkeypatch, parsed: _FakeParsed | None) -> _FakeResponses:
    fake_responses = _FakeResponses(parsed)
    monkeypatch.setattr(
        openai_gpt, "OpenAI", lambda **kwargs: _FakeClient(responses=fake_responses)
    )
    return fake_responses


def test_request_passes_pdf_as_base64_input_file(monkeypatch):
    pdf_bytes = b"%PDF-1.4 hello"
    parsed = _FakeParsed({
        "weekly_schedule": {"masses": [], "confessions": [], "adorations": []},
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": False,
        "published_date": None,
        "wrong_bulletin": False,
    })
    fake = _install_fake(monkeypatch, parsed)

    classifier = OpenAIClassifier(model="gpt-5.4-mini")
    classifier.extract(
        pdf_bytes,
        churches=[{"slug": "st-mary", "name": "St. Mary", "address": "123 Main"}],
        today=date(2026, 5, 4),
    )

    assert fake.call_count == 1
    kwargs = fake.last_kwargs
    assert kwargs["model"] == "gpt-5.4-mini"
    # Pydantic class is passed through as text_format; SDK derives schema.
    assert kwargs["text_format"].__name__ == "SchedulePayload"

    content = kwargs["input"][0]["content"]
    file_part = next(p for p in content if p["type"] == "input_file")
    text_part = next(p for p in content if p["type"] == "input_text")

    expected_b64 = base64.b64encode(pdf_bytes).decode("ascii")
    assert file_part["file_data"] == f"data:application/pdf;base64,{expected_b64}"
    assert file_part["filename"].endswith(".pdf")
    assert "Mass, Confession" in text_part["text"]
    assert "st-mary" in text_part["text"]
    assert "2026-05-04" in text_part["text"]


def test_returns_normalized_event_shape(monkeypatch):
    parsed = _FakeParsed({
        "weekly_schedule": {
            "masses": [
                {
                    "church_slug": "st-mary",
                    "day_of_week": "Sunday",
                    "start_time": "9:00 AM",
                    "end_time": None,
                    "page_number": 1,
                    "note": None,
                }
            ],
            "confessions": [],
            "adorations": [],
        },
        "single_events": {"masses": [], "confessions": [], "adorations": []},
        "cancellations": {"masses": [], "confessions": [], "adorations": []},
        "church_list_needs_review": False,
        "published_date": "2026-05-03",
        "wrong_bulletin": False,
    })
    _install_fake(monkeypatch, parsed)

    classifier = OpenAIClassifier()
    out = classifier.extract(
        b"%PDF-1.4 x", churches=[{"slug": "st-mary", "name": "x", "address": "x"}],
        today=date(2026, 5, 4),
    )
    assert out["published_date"] == "2026-05-03"
    assert out["wrong_bulletin"] is False
    assert len(out["events"]) == 1
    ev = out["events"][0]
    assert ev["church_slug"] == "st-mary"
    assert ev["type"] == "mass"
    assert ev["kind"] == "weekly"
    assert ev["day_of_week"] == "Sunday"
    assert ev["start_time"] == "9:00 AM"


def test_empty_pdf_short_circuits_without_calling_api(monkeypatch):
    fake = _install_fake(monkeypatch, parsed=None)

    classifier = OpenAIClassifier()
    out = classifier.extract(b"", churches=[], today=date(2026, 5, 4))

    assert fake.call_count == 0
    assert out["events"] == []
    assert out["wrong_bulletin"] is False


def test_refusal_or_missing_parsed_returns_empty_result(monkeypatch):
    _install_fake(monkeypatch, parsed=None)  # output_parsed is None

    classifier = OpenAIClassifier()
    out = classifier.extract(
        b"%PDF-1.4 x", churches=[], today=date(2026, 5, 4),
    )
    assert out["events"] == []


def test_classifier_is_registered():
    from pdf_extract.classifiers import REGISTRY, get_classifier

    assert "gpt-5.4-mini" in REGISTRY
    c = get_classifier("gpt-5.4-mini")
    assert c.name == "gpt-5.4-mini"
    assert c.version == "gpt-5.4-mini"


@pytest.mark.parametrize("custom_name", ["alt-name", None])
def test_name_defaults_to_model_id(custom_name):
    c = OpenAIClassifier(model="gpt-5.4-mini", name=custom_name)
    assert c.name == (custom_name or "gpt-5.4-mini")
