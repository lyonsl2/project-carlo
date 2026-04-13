"""Extract structured schedule data from bulletin PDFs using Gemini."""

import json
import logging
import random
import time
from typing import Any, Literal

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ConfigDict, Field

LOGGER = logging.getLogger(__name__)
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
_MAX_API_ATTEMPTS = 5
_BASE_BACKOFF_SECONDS = 2.0
_MAX_BACKOFF_SECONDS = 30.0

# ── LLM extraction schema ──────────────────────────────────────────────────


class WeeklySlot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    church_slug: str = Field(min_length=1)
    day_of_week: str = Field(min_length=1)
    start_time: str = Field(min_length=1)
    end_time: str | None = None
    page_number: int | None = None


class DateSlot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    church_slug: str = Field(min_length=1)
    date: str = Field(min_length=1)
    start_time: str = Field(min_length=1)
    end_time: str | None = None
    page_number: int | None = None


class WeeklySchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    masses: list[WeeklySlot] = []
    confessions: list[WeeklySlot] = []
    adorations: list[WeeklySlot] = []


class SingleEvents(BaseModel):
    model_config = ConfigDict(extra="forbid")

    masses: list[DateSlot] = []
    confessions: list[DateSlot] = []
    adorations: list[DateSlot] = []


class Cancellations(BaseModel):
    model_config = ConfigDict(extra="forbid")

    masses: list[DateSlot] = []
    confessions: list[DateSlot] = []
    adorations: list[DateSlot] = []


class SchedulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekly_schedule: WeeklySchedule = Field(default_factory=WeeklySchedule)
    single_events: SingleEvents = Field(default_factory=SingleEvents)
    cancellations: Cancellations = Field(default_factory=Cancellations)
    church_list_needs_review: bool = False


def _valid_str(s: Any) -> bool:
    return isinstance(s, str) and bool(s.strip())


def _collect_events(
    section: dict[str, Any],
    *,
    kind: Literal["weekly", "specific_date"],
    cancelled: bool,
) -> list[dict[str, Any]]:
    """Collect flat events from a section (weekly_schedule, single_events, or cancellations)."""
    if not isinstance(section, dict):
        return []
    events: list[dict[str, Any]] = []
    for event_type, key in [("mass", "masses"), ("confession", "confessions"), ("adoration", "adorations")]:
        for item in section.get(key) or []:
            if not isinstance(item, dict):
                continue
            church_slug = item.get("church_slug")
            start_time = item.get("start_time")
            if kind == "weekly":
                day_of_week = item.get("day_of_week")
                date_val = None
                if not _valid_str(church_slug) or not _valid_str(start_time) or not _valid_str(day_of_week):
                    continue
            else:
                day_of_week = None
                date_val = item.get("date")
                if not _valid_str(church_slug) or not _valid_str(start_time) or not _valid_str(date_val):
                    continue
            end_time = item.get("end_time") if isinstance(item.get("end_time"), str) else None
            page_number = item.get("page_number") if isinstance(item.get("page_number"), int) else None
            events.append({
                "church_slug": church_slug,
                "type": event_type,
                "kind": kind,
                "day_of_week": day_of_week,
                "date": date_val,
                "start_time": start_time,
                "end_time": end_time,
                "cancelled": cancelled,
                "page_number": page_number,
            })
    return events


def reconstruct_events(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert structured schema to flat events format.

    Returns:
        Dict with "events" (list of flat event dicts) and "church_list_needs_review" (bool).
    """
    ws = raw.get("weekly_schedule") or {}
    se = raw.get("single_events") or {}
    can = raw.get("cancellations") or {}

    events: list[dict[str, Any]] = []
    events.extend(_collect_events(ws, kind="weekly", cancelled=False))
    events.extend(_collect_events(se, kind="specific_date", cancelled=False))
    events.extend(_collect_events(can, kind="specific_date", cancelled=True))

    church_list_needs_review = bool(raw.get("church_list_needs_review", False))
    return {"events": events, "church_list_needs_review": church_list_needs_review}


def _is_retryable_api_error(exc: Exception) -> bool:
    """Return true when the Gemini API error is likely transient."""
    return isinstance(exc, errors.APIError) and exc.code in _RETRYABLE_STATUS_CODES


def _generate_content_with_backoff(
    client: genai.Client,
    *,
    model: str,
    contents: list[str | types.Part],
    config: types.GenerateContentConfig,
):
    """Call Gemini generate_content with exponential backoff for transient API failures."""
    for attempt in range(1, _MAX_API_ATTEMPTS + 1):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            is_last_attempt = attempt == _MAX_API_ATTEMPTS
            if not _is_retryable_api_error(exc) or is_last_attempt:
                raise

            backoff = min(_MAX_BACKOFF_SECONDS, _BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)))
            delay = backoff + random.uniform(0, 0.25 * backoff)
            LOGGER.warning(
                "Gemini request failed with status %s on attempt %s/%s; retrying in %.1fs",
                getattr(exc, "code", "unknown"),
                attempt,
                _MAX_API_ATTEMPTS,
                delay,
            )
            time.sleep(delay)


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

    church_slug: str
    name_status: Literal["verified", "incorrect", "unverifiable"]
    address_status: Literal["verified", "incorrect", "unverifiable"]
    corrected_name: str | None = None
    corrected_address: Address | None = None
    slug_needs_review: bool = False


class NewChurch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    slug: str | None = None
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

Each church in the list has a "slug" (stable identifier), "name", and "address". Map each event to one of the known churches.

Structure your response as follows:

weekly_schedule: Recurring weekly schedule. Each category (masses, confessions, adorations) is an array of entries:
   - masses: church_slug, day_of_week, start_time (no end_time for Mass), page_number
   - confessions: church_slug, day_of_week, start_time, end_time (optional, include when provided), page_number
   - adorations: church_slug, day_of_week, start_time, end_time (optional, include when provided), page_number

single_events: One-off or exception dates (e.g. extra Mass on a holiday, special confession times). Same structure as weekly_schedule but use "date" instead of "day_of_week":
   - masses: church_slug, date, start_time, page_number
   - confessions: church_slug, date, start_time, end_time (optional), page_number
   - adorations: church_slug, date, start_time, end_time (optional), page_number

cancellations: Specific dates/times when a regular schedule is cancelled. Same structure as single_events:
   - masses: church_slug, date, start_time, page_number
   - confessions: church_slug, date, start_time, end_time (optional), page_number
   - adorations: church_slug, date, start_time, end_time (optional), page_number

church_list_needs_review: boolean flag

Rules:
- Every entry must use a church_slug that exactly matches one of the provided churches.
- Format all times as "h:MM AM" or "h:MM PM".
- For Mass: always include start_time; end_time is omitted.
- For Confession and Adoration: include end_time when the document provides it.
- For every entry, include page_number (1-indexed integer for which page of the PDF the event was found on).
- Put recurring weekly entries in weekly_schedule.
- Put one-off or exception dates in single_events (e.g. extra Mass on Christmas).
- Put cancelled times in cancellations (e.g. "No 8am Mass on March 16").
- Do NOT put a single_events entry if it is identical to an existing weekly_schedule entry.
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
        - "events": list of event dicts (each with church_slug, type, kind, etc.)
        - "church_list_needs_review": bool

    """
    if not pdf_bytes:
        return reconstruct_events({})

    churches_json = json.dumps(churches, ensure_ascii=False)
    prompt = EVENTS_SYSTEM_PROMPT.format(churches_json=churches_json)

    client = genai.Client()
    response = _generate_content_with_backoff(
        client,
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
    return reconstruct_events(data)


# ── Verification extraction ──────────────────────────────────────────────────


VERIFY_SYSTEM_PROMPT = """\
You are a precise assistant that verifies church information against a Catholic parish bulletin PDF.

You are given:
1) A parish bulletin PDF
2) A list of known churches for this parish: {churches_json}

Each church in the list has a "slug" (stable URL identifier), "name", and "address".

For each church in the provided list:
- Echo back the church_slug exactly as provided (this is the only church identifier needed).
- Check if the church name can be verified from the bulletin. Report name_status as:
  - "verified" if the name matches what's in the bulletin
  - "incorrect" if the bulletin shows a different name — provide corrected_name
  - "unverifiable" if the bulletin doesn't mention this church
- Check if the church address can be verified from the bulletin. Report address_status as:
  - "verified" if the address matches what's in the bulletin
  - "incorrect" if the bulletin shows a different address — provide corrected_address as a structured object with fields: line1, line2 (or null), city, state, postal_code
  - "unverifiable" if the bulletin doesn't show an address for this church
- Set slug_needs_review to true ONLY if the slug is clearly a poor match for this church (e.g. slug says one city but the church is obviously in a different city, or slug refers to a completely different saint). Otherwise false.

For any churches that are clearly part of this parish (not guest/visiting churches) and are NOT in the provided list, add them to new_churches with name, slug (a short URL-friendly identifier based on the church name and city, like "st-marys-corning"), and address (as a structured object with line1, line2, city, state, postal_code).

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
    response = _generate_content_with_backoff(
        client,
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
        church_slug = c.get("church_slug")
        if not isinstance(church_slug, str) or not church_slug.strip():
            continue
        name_status = c.get("name_status")
        if name_status not in {"verified", "incorrect", "unverifiable"}:
            name_status = "unverifiable"
        address_status = c.get("address_status")
        if address_status not in {"verified", "incorrect", "unverifiable"}:
            address_status = "unverifiable"
        entry: dict[str, Any] = {
            "church_slug": church_slug,
            "name_status": name_status,
            "address_status": address_status,
            "slug_needs_review": bool(c.get("slug_needs_review", False)),
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
        slug = c.get("slug")
        new_churches.append({
            "name": name,
            "slug": slug if isinstance(slug, str) else None,
            "address": c.get("address") if isinstance(c.get("address"), dict) else None,
        })

    payload = VerificationPayload.model_validate(
        {"existing_churches": existing, "new_churches": new_churches}
    )
    return payload.model_dump(mode="json")
