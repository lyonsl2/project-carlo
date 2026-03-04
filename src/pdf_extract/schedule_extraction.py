"""Extract structured schedule data from document text using the OpenAI API."""

import json
import os
from typing import Any, Literal

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field


class Church(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str | None
    address: str | None


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")

    church_id: str = Field(min_length=1)
    type: Literal["mass", "confession", "adoration"]
    kind: Literal["weekly", "specific_date"]
    day_of_week: str | None
    date: str | None
    start_time: str = Field(min_length=1)
    end_time: str | None
    cancelled: bool


class SchedulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    churches: list[Church]
    events: list[Event]


EVENTS_SYSTEM_PROMPT = """You are a precise assistant that extracts only Mass, Confession, and Adoration schedule information from text (e.g. a Catholic parish bulletin).

Extract ONLY these three types: Mass, Confession, and Adoration.

The document may describe ONE or SEVERAL churches/parishes.

Structure your response as follows:

1) churches: An array of church/location entries. Each entry has:
   - id: short stable identifier like "c1", "c2", ...
   - name: Full name of the church/parish for this location (or null if unclear)
   - address: Full address for this church (or null if not given)

2) events: An array of schedule entries. Each entry has:
   - church_id: church id from churches[].id
   - type: one of "mass", "confession", "adoration"
   - kind: "weekly" or "specific_date"
   - start_time: time when it starts
   - end_time: optional, include when provided in source text
   - cancelled: true only when this entry indicates a weekly time is cancelled for a specific day; otherwise false
   - day_of_week: required when kind = "weekly"
   - date: required when kind = "specific_date"

Rules:
- If the text describes multiple churches or locations, include one object per church in churches.
- Every event must reference a valid church_id from churches.
- If only one church is mentioned, churches will have one element.
- For Mass: always include start_time; end_time is usually null/omitted unless explicitly provided.
- For Confession and Adoration: include end_time when the document provides it.
- Use kind="weekly" for recurring weekly schedule entries.
- Use kind="specific_date" for one-off or exception entries.
- Do NOT include a specific-date event if it is identical to an existing weekly entry.
- If no church name/address is found, use null.

Return output that matches the provided JSON schema exactly."""


EVENTS_JSON_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "name": "church_schedule",
    "strict": True,
    "schema": SchedulePayload.model_json_schema(),
}


def extract_events(
    text: str,
    *,
    api_key: str | None = None,
    model: str = "gpt-5-nano",
) -> dict[str, Any]:
    """Use the OpenAI API to extract Mass, Confession, and Adoration schedule from document text.

    Args:
        text: Raw text (e.g. from a PDF) to analyze.
        api_key: OpenAI API key. If not set, uses the OPENAI_API_KEY environment variable.
        model: OpenAI model to use (e.g. gpt-5-nano, gpt-4o).

    Returns:
        Dict with:
        - "churches": list of church objects (id, name, address)
        - "events": list of events that reference churches by church_id

    Raises:
        ValueError: If no API key is provided or set in OPENAI_API_KEY.
        openai.APIError: On API errors.
    """
    key = api_key or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ValueError(
            "OpenAI API key required. Set OPENAI_API_KEY or pass api_key=..."
        )

    client = OpenAI(api_key=key)
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "system",
                "content": [{"type": "input_text", "text": EVENTS_SYSTEM_PROMPT}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": text}],
            },
            {
                "role": "system",
                "content": [{"type": "input_text", "text": EVENTS_SYSTEM_PROMPT}],
            },
        ],
        reasoning={"effort": "medium"},
        text={"format": EVENTS_JSON_SCHEMA},
    )
    content = response.output_text or "{}"
    data = json.loads(content)
    if not isinstance(data, dict):
        data = {}
    return _normalize_payload(data)


def _normalize_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize model payload to {churches: [...], events: [...]}."""
    raw_churches = data.get("churches")
    if not isinstance(raw_churches, list):
        raw_churches = []

    churches: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    church_ids: set[str] = set()

    for i, c in enumerate(raw_churches, start=1):
        if not isinstance(c, dict):
            continue
        church_id = c.get("id")
        if not isinstance(church_id, str) or not church_id.strip():
            church_id = f"c{i}"
        church_ids.add(church_id)

        name = c.get("name")
        address = c.get("address")

        churches.append(
            {
                "id": church_id,
                "name": name if isinstance(name, str) else None,
                "address": address if isinstance(address, str) else None,
            }
        )

    raw_events = data.get("events")
    if isinstance(raw_events, list):
        normalized_events: list[dict[str, Any]] = []
        for e in raw_events:
            if not isinstance(e, dict):
                continue
            church_id = e.get("church_id")
            if not isinstance(church_id, str):
                continue
            if church_id not in church_ids:
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
            normalized_events.append(
                {
                    "church_id": church_id,
                    "type": event_type,
                    "kind": event_kind,
                    "day_of_week": day_of_week if isinstance(day_of_week, str) else None,
                    "date": date if isinstance(date, str) else None,
                    "start_time": start_time,
                    "end_time": e.get("end_time") if isinstance(e.get("end_time"), str) else None,
                    "cancelled": bool(e.get("cancelled", False)),
                }
            )
        events = normalized_events

    payload = SchedulePayload.model_validate({"churches": churches, "events": events})
    return payload.model_dump(mode="json")
