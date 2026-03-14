"""Extract structured schedule data from bulletin PDFs using Gemini."""

import json
from typing import Any, Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field


# ── Event extraction models ──────────────────────────────────────────────────


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")

    church_name: str = Field(min_length=1)
    type: Literal["mass", "confession", "adoration"]
    kind: Literal["weekly", "specific_date"]
    day_of_week: str | None
    date: str | None
    start_time: str = Field(min_length=1)
    end_time: str | None
    cancelled: bool


class SchedulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[Event]
    church_list_needs_review: bool = False


# ── Verification models ──────────────────────────────────────────────────────


class Address(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line1: str | None = None
    line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None


class ChurchVerification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    church_name: str
    name_status: Literal["verified", "incorrect", "unverifiable"]
    address_status: Literal["verified", "incorrect", "unverifiable"]
    corrected_name: str | None = None
    corrected_address: Address | None = None


class NewChurch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    address: Address | None = None


class VerificationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    existing_churches: list[ChurchVerification]
    new_churches: list[NewChurch]


# ── Event extraction ─────────────────────────────────────────────────────────


EVENTS_SYSTEM_PROMPT = """\
You are a precise assistant that extracts only Mass, Confession, and Adoration schedule information from a Catholic parish bulletin PDF.

Extract ONLY these three types: Mass, Confession, and Adoration.

You are given:
1) A parish bulletin PDF
2) Known churches for this parish: {churches_json}

Map each event to one of the known church names EXACTLY as provided in the list above.

Structure your response as follows:

events: An array of schedule entries. Each entry has:
   - church_name: must exactly match one of the provided church names
   - type: one of "mass", "confession", "adoration"
   - kind: "weekly" or "specific_date"
   - start_time: time when it starts
   - end_time: optional, include when provided in source text
   - cancelled: true only when this entry indicates a weekly time is cancelled for a specific day; otherwise false
   - day_of_week: required when kind = "weekly"
   - date: required when kind = "specific_date"

church_list_needs_review: boolean flag

Rules:
- Every event must use a church_name that exactly matches one of the provided church names.
- For Mass: always include start_time; end_time is usually null/omitted unless explicitly provided.
- For Confession and Adoration: include end_time when the document provides it.
- Use kind="weekly" for recurring weekly schedule entries.
- Use kind="specific_date" for one-off or exception entries.
- Do NOT include a specific-date event if it is identical to an existing weekly entry.
- Set church_list_needs_review to true ONLY if:
  - The bulletin clearly shows a church that is NOT in the provided list
  - A provided church name/address is obviously wrong

Return output that matches the provided JSON schema exactly."""


def extract_events(
    pdf_bytes: bytes,
    *,
    churches: list[dict],
    model: str = "gemini-3-flash-preview",
) -> dict[str, Any]:
    """Use Gemini to extract Mass, Confession, and Adoration schedule from a PDF.

    Args:
        pdf_bytes: Raw PDF bytes to analyze.
        churches: List of known churches [{name, address}, ...].
        model: Gemini model to use.

    Returns:
        Dict with:
        - "events": list of events with church_name
        - "church_list_needs_review": bool

    """
    if not pdf_bytes:
        return _normalize_payload({})

    churches_json = json.dumps(churches, ensure_ascii=False)
    prompt = EVENTS_SYSTEM_PROMPT.format(churches_json=churches_json)

    client = genai.Client()
    response = client.models.generate_content(
        model=model,
        contents=[
            prompt,
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=SchedulePayload.model_json_schema(),
        ),
    )
    content = response.text or "{}"
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return _normalize_payload(data)


def _normalize_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize model payload to {events: [...], church_list_needs_review: bool}."""
    events: list[dict[str, Any]] = []

    raw_events = data.get("events")
    if isinstance(raw_events, list):
        for e in raw_events:
            if not isinstance(e, dict):
                continue
            church_name = e.get("church_name")
            if not isinstance(church_name, str) or not church_name.strip():
                continue
            event_type = e.get("type")
            if event_type not in {"mass", "confession", "adoration"}:
                continue
            event_kind = e.get("kind")
            if event_kind not in {"weekly", "specific_date"}:
                continue
            start_time = e.get("start_time")
            if not isinstance(start_time, str) or not start_time.strip():
                continue
            day_of_week = e.get("day_of_week")
            date = e.get("date")
            if event_kind == "weekly" and not isinstance(day_of_week, str):
                continue
            if event_kind == "specific_date" and not isinstance(date, str):
                continue
            events.append(
                {
                    "church_name": church_name,
                    "type": event_type,
                    "kind": event_kind,
                    "day_of_week": day_of_week if isinstance(day_of_week, str) else None,
                    "date": date if isinstance(date, str) else None,
                    "start_time": start_time,
                    "end_time": e.get("end_time") if isinstance(e.get("end_time"), str) else None,
                    "cancelled": bool(e.get("cancelled", False)),
                }
            )

    church_list_needs_review = bool(data.get("church_list_needs_review", False))

    payload = SchedulePayload.model_validate(
        {"events": events, "church_list_needs_review": church_list_needs_review}
    )
    return payload.model_dump(mode="json")


# ── Verification extraction ──────────────────────────────────────────────────


VERIFY_SYSTEM_PROMPT = """\
You are a precise assistant that verifies church information against a Catholic parish bulletin PDF.

You are given:
1) A parish bulletin PDF
2) A list of known churches for this parish: {churches_json}

For each church in the provided list:
- Check if the church name can be verified from the bulletin. Report name_status as:
  - "verified" if the name matches what's in the bulletin
  - "incorrect" if the bulletin shows a different name — provide corrected_name
  - "unverifiable" if the bulletin doesn't mention this church
- Check if the church address can be verified from the bulletin. Report address_status as:
  - "verified" if the address matches what's in the bulletin
  - "incorrect" if the bulletin shows a different address — provide corrected_address as a structured object with fields: line1, line2 (or null), city, state, postal_code
  - "unverifiable" if the bulletin doesn't show an address for this church

For any churches that are clearly part of this parish (not guest/visiting churches) and are NOT in the provided list, add them to new_churches with name and address (as a structured object with line1, line2, city, state, postal_code).

Return output that matches the provided JSON schema exactly."""


def extract_verification(
    pdf_bytes: bytes,
    *,
    churches: list[dict],
    model: str = "gemini-3-flash-preview",
) -> dict[str, Any]:
    """Use Gemini to verify church data against a bulletin PDF.

    Args:
        pdf_bytes: Raw PDF bytes to analyze.
        churches: List of known churches [{name, address}, ...].
        model: Gemini model to use.

    Returns:
        Dict with existing_churches and new_churches.
    """
    if not pdf_bytes:
        return {"existing_churches": [], "new_churches": []}

    churches_json = json.dumps(churches, ensure_ascii=False)
    prompt = VERIFY_SYSTEM_PROMPT.format(churches_json=churches_json)

    client = genai.Client()
    response = client.models.generate_content(
        model=model,
        contents=[
            prompt,
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=VerificationPayload.model_json_schema(),
        ),
    )
    content = response.text or "{}"
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return _normalize_verification(data)


def _normalize_verification(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize verification payload."""
    existing: list[dict[str, Any]] = []
    new_churches: list[dict[str, Any]] = []

    for c in data.get("existing_churches", []):
        if not isinstance(c, dict):
            continue
        church_name = c.get("church_name")
        if not isinstance(church_name, str) or not church_name.strip():
            continue
        name_status = c.get("name_status")
        if name_status not in {"verified", "incorrect", "unverifiable"}:
            name_status = "unverifiable"
        address_status = c.get("address_status")
        if address_status not in {"verified", "incorrect", "unverifiable"}:
            address_status = "unverifiable"
        entry: dict[str, Any] = {
            "church_name": church_name,
            "name_status": name_status,
            "address_status": address_status,
        }
        if name_status == "incorrect":
            corrected = c.get("corrected_name")
            entry["corrected_name"] = corrected if isinstance(corrected, str) else None
        else:
            entry["corrected_name"] = None
        if address_status == "incorrect":
            corrected = c.get("corrected_address")
            entry["corrected_address"] = corrected if isinstance(corrected, dict) else None
        else:
            entry["corrected_address"] = None
        existing.append(entry)

    for c in data.get("new_churches", []):
        if not isinstance(c, dict):
            continue
        name = c.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        new_churches.append({
            "name": name,
            "address": c.get("address") if isinstance(c.get("address"), dict) else None,
        })

    payload = VerificationPayload.model_validate(
        {"existing_churches": existing, "new_churches": new_churches}
    )
    return payload.model_dump(mode="json")
