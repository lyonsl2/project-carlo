"""Extract structured schedule data from bulletin PDFs using Gemini."""

import json
import logging
import random
import re
import threading
import time
from datetime import date
from typing import Any, Literal

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ConfigDict, Field, ValidationError

LOGGER = logging.getLogger(__name__)
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
_MAX_API_ATTEMPTS = 8
_BASE_BACKOFF_SECONDS = 2.0
_MAX_BACKOFF_SECONDS = 30.0

# Shared backoff gate: when any thread hits a transient Gemini error, no thread
# starts a new request until the backoff window has expired. This stops fresh
# requests from outcompeting the backed-off one for quota.
_pause_lock = threading.Lock()
_pause_until = 0.0  # time.monotonic() deadline


def _wait_for_gate() -> None:
    """Block until any active global backoff window has expired."""
    while True:
        with _pause_lock:
            remaining = _pause_until - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(remaining)


def _extend_gate(delay: float) -> None:
    """Hold all new Gemini requests for at least `delay` seconds from now."""
    global _pause_until
    deadline = time.monotonic() + delay
    with _pause_lock:
        _pause_until = max(_pause_until, deadline)

# ── LLM extraction schema ──────────────────────────────────────────────────


class WeeklySlot(BaseModel):
    """One recurring weekly time slot at a church (Mass, Confession, or Adoration)."""

    model_config = ConfigDict(extra="forbid")

    church_slug: str = Field(min_length=1, description="Must exactly match a `slug` from the provided known-churches list.")
    day_of_week: str = Field(min_length=1, description="Full English weekday name, e.g. `Monday`.")
    start_time: str = Field(min_length=1, description="Formatted as `h:MM AM` or `h:MM PM`.")
    end_time: str | None = Field(default=None, description="For Mass, leave null. For Confession and Adoration, include when available.")
    page_number: int | None = Field(default=None, description="1-indexed PDF page where this entry was found.")
    note: str | None = Field(default=None, description="Short phrase only when there is genuinely special context (language, season, location nuance, benediction, etc.).")


class DateSlot(BaseModel):
    """One calendar-dated time slot at a church (Mass, Confession, or Adoration)."""

    model_config = ConfigDict(extra="forbid")

    church_slug: str = Field(min_length=1, description="Must exactly match a `slug` from the provided known-churches list.")
    date: str = Field(min_length=1, description="Specific calendar date formatted as `YYYY-MM-DD`.")
    start_time: str = Field(min_length=1, description="Formatted as `h:MM AM` or `h:MM PM`.")
    end_time: str | None = Field(default=None, description="For Mass, leave null. For Confession and Adoration, include when available.")
    page_number: int | None = Field(default=None, description="1-indexed PDF page where this entry was found.")
    note: str | None = Field(default=None, description="Short phrase only when there is genuinely special context (language, season, location nuance, benediction, etc.).")


class WeeklySchedule(BaseModel):
    """Recurring weekly lines grouped by Mass, Confession, and Adoration."""

    model_config = ConfigDict(extra="forbid")

    masses: list[WeeklySlot] = Field(default_factory=list)
    confessions: list[WeeklySlot] = Field(default_factory=list)
    adorations: list[WeeklySlot] = Field(default_factory=list)


class SingleEvents(BaseModel):
    """One-off or extra dated occurrences not already covered by `WeeklySchedule`."""

    model_config = ConfigDict(extra="forbid")

    masses: list[DateSlot] = Field(default_factory=list)
    confessions: list[DateSlot] = Field(default_factory=list)
    adorations: list[DateSlot] = Field(default_factory=list)


class Cancellations(BaseModel):
    """Dated occurrences the bulletin marks as cancelled."""

    model_config = ConfigDict(extra="forbid")

    masses: list[DateSlot] = Field(default_factory=list)
    confessions: list[DateSlot] = Field(default_factory=list)
    adorations: list[DateSlot] = Field(default_factory=list)


class SchedulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekly_schedule: WeeklySchedule = Field(
        default_factory=WeeklySchedule,
        description="Recurring weekly Mass, Confession, and Adoration entries.",
    )
    single_events: SingleEvents = Field(
        default_factory=SingleEvents,
        description=(
            "One-off or extra dates. Do not include an entry that duplicates an existing `weekly_schedule` slot."
        ),
    )
    cancellations: Cancellations = Field(
        default_factory=Cancellations,
        description=(
            "Include cancelled events here."
        ),
    )
    church_list_needs_review: bool = Field(
        default=False,
        description=(
            "True only if (a) the bulletin clearly shows a church in the parish that has events but is not in the provided list, "
            "or (b) a provided church name/address is obviously wrong."
        ),
    )
    published_date: str | None = Field(
        default=None,
        description=(
            "The bulletin's issue date as `YYYY-MM-DD`."
        ),
    )
    wrong_bulletin: bool = Field(
        default=False,
        description=(
            "True only if this is clearly not the correct bulletin (not a bulletin at all, not the correct parish, from a different year, etc.)"
        ),
    )


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
            note_raw = item.get("note")
            note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
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
                "note": note,
            })
    return events


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _normalize_published_date(raw: Any) -> str | None:
    """Accept a YYYY-MM-DD string from the LLM, or None."""
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value:
        return None
    if not _ISO_DATE_RE.match(value):
        return None
    return value


def _note_value(note: str | None) -> str | None:
    if note is None:
        return None
    stripped = note.strip()
    return stripped or None


def _weekly_slot_to_event(
    slot: WeeklySlot,
    *,
    event_type: Literal["mass", "confession", "adoration"],
    cancelled: bool,
) -> dict[str, Any]:
    return {
        "church_slug": slot.church_slug,
        "type": event_type,
        "kind": "weekly",
        "day_of_week": slot.day_of_week,
        "date": None,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "cancelled": cancelled,
        "page_number": slot.page_number,
        "note": _note_value(slot.note),
    }


def _date_slot_to_event(
    slot: DateSlot,
    *,
    event_type: Literal["mass", "confession", "adoration"],
    cancelled: bool,
) -> dict[str, Any]:
    return {
        "church_slug": slot.church_slug,
        "type": event_type,
        "kind": "specific_date",
        "day_of_week": None,
        "date": slot.date,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "cancelled": cancelled,
        "page_number": slot.page_number,
        "note": _note_value(slot.note),
    }


def _events_from_payload(payload: SchedulePayload) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for event_type, slots in [
        ("mass", payload.weekly_schedule.masses),
        ("confession", payload.weekly_schedule.confessions),
        ("adoration", payload.weekly_schedule.adorations),
    ]:
        for slot in slots:
            events.append(_weekly_slot_to_event(slot, event_type=event_type, cancelled=False))
    for event_type, slots in [
        ("mass", payload.single_events.masses),
        ("confession", payload.single_events.confessions),
        ("adoration", payload.single_events.adorations),
    ]:
        for slot in slots:
            events.append(_date_slot_to_event(slot, event_type=event_type, cancelled=False))
    for event_type, slots in [
        ("mass", payload.cancellations.masses),
        ("confession", payload.cancellations.confessions),
        ("adoration", payload.cancellations.adorations),
    ]:
        for slot in slots:
            events.append(_date_slot_to_event(slot, event_type=event_type, cancelled=True))
    return events


def _reconstruct_events_from_dict(raw: dict[str, Any]) -> dict[str, Any]:
    ws = raw.get("weekly_schedule") or {}
    se = raw.get("single_events") or {}
    can = raw.get("cancellations") or {}

    events: list[dict[str, Any]] = []
    events.extend(_collect_events(ws, kind="weekly", cancelled=False))
    events.extend(_collect_events(se, kind="specific_date", cancelled=False))
    events.extend(_collect_events(can, kind="specific_date", cancelled=True))

    return {
        "events": events,
        "church_list_needs_review": bool(raw.get("church_list_needs_review", False)),
        "published_date": _normalize_published_date(raw.get("published_date")),
        "wrong_bulletin": bool(raw.get("wrong_bulletin", False)),
    }


def reconstruct_events(raw: SchedulePayload | dict[str, Any]) -> dict[str, Any]:
    """Convert structured schema to flat events format.

    Returns:
        Dict with "events" (list of flat event dicts), "church_list_needs_review" (bool),
        "published_date" (str | None, YYYY-MM-DD), and "wrong_bulletin" (bool).
    """
    if isinstance(raw, SchedulePayload):
        return {
            "events": _events_from_payload(raw),
            "church_list_needs_review": raw.church_list_needs_review,
            "published_date": _normalize_published_date(raw.published_date),
            "wrong_bulletin": raw.wrong_bulletin,
        }
    return _reconstruct_events_from_dict(raw)


def _parse_llm_json(content: str, *, context: str) -> dict[str, Any]:
    """Parse a Gemini JSON string, warning (not raising) on bad output.

    Gemini is configured with response_mime_type=application/json and a JSON schema,
    so malformed output or non-dict top-level values indicate an LLM-side problem.
    We coalesce to {} so downstream normalisation treats it as an empty result,
    but log enough detail to distinguish this from a genuinely empty bulletin.
    """
    snippet = content[:200].replace("\n", " ")
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        LOGGER.warning(
            "%s: failed to parse Gemini JSON (len=%d, err=%s): %r",
            context, len(content), exc, snippet,
        )
        return {}
    if not isinstance(data, dict):
        LOGGER.warning(
            "%s: Gemini JSON top-level is %s, expected object (len=%d): %r",
            context, type(data).__name__, len(content), snippet,
        )
        return {}
    return data


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
    """Call Gemini generate_content with exponential backoff for transient API failures.

    Backoff windows are shared process-wide via the gate above: while any thread
    is backing off, no thread starts a new request.
    """
    for attempt in range(1, _MAX_API_ATTEMPTS + 1):
        _wait_for_gate()
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
            _extend_gate(delay)


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

    church_slug: str = Field(min_length=1)
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
# Role

Extract Mass, Confession, and Adoration schedule information from the attached Catholic parish bulletin PDF.

# Known churches for this parish

```json
{churches_json}
```

# Today's date

{today_iso} ({today_day_of_week})

# Instructions

- Only extract Mass, Confession, and Adoration events. Ignore every other kind of event or activity in the bulletin.
- Attach every event to one of the churches in the known-churches list using its exact `slug`.
- Sort each event into exactly one bucket:
  - `weekly_schedule` for recurring weekly times.
  - `single_events` for one-off or extra occurrences on a specific date that are not already covered by a weekly entry.
  - `cancellations` for events that the bulletin explicitly says are cancelled, moved, or will not take place on a specific date.
- Never duplicate a weekly slot as a single event just because the bulletin also mentions it in a specific week.
- Only add a `note` when there is genuinely special context worth surfacing (language, season, alternate location, benediction, etc.). No need to specify 'Vigil Mass'.
- Identify the bulletin's own issue date and report it as `published_date`.
- Set `wrong_bulletin` to true only if the attached PDF is clearly not a current bulletin for this parish (wrong parish, wrong year, not a bulletin at all, etc.). In that case you may return empty event lists.

Carefully find the events listed in the bulletin.
"""


def extract_events(
    pdf_bytes: bytes,
    *,
    churches: list[dict],
    model: str = "gemini-3-flash-preview",
    today: date | None = None,
) -> dict[str, Any]:
    """Use Gemini to extract Mass, Confession, and Adoration schedule from a PDF.

    Args:
        pdf_bytes: Raw PDF bytes to analyze.
        churches: List of known churches [{name, address}, ...].
        model: Gemini model to use.
        today: Reference date used to help the LLM judge whether the bulletin is
            stale/misrouted. Defaults to today's local date.

    Returns:
        Dict with:
        - "events": list of event dicts (each with church_slug, type, kind, etc., including note)
        - "church_list_needs_review": bool
        - "published_date": str | None (YYYY-MM-DD)
        - "wrong_bulletin": bool

    """
    if not pdf_bytes:
        return reconstruct_events({})

    if today is None:
        today = date.today()

    churches_json = json.dumps(churches, ensure_ascii=False)
    prompt = EVENTS_SYSTEM_PROMPT.format(
        churches_json=churches_json,
        today_iso=today.isoformat(),
        today_day_of_week=today.strftime("%A"),
    )

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
        payload = SchedulePayload.model_validate_json(content)
    except ValidationError as exc:
        LOGGER.warning(
            "extract_events: Pydantic validation failed (%s); using lenient fallback",
            exc,
        )
        return reconstruct_events(_parse_llm_json(content, context="extract_events"))
    return reconstruct_events(payload)


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
        payload = VerificationPayload.model_validate_json(content)
    except ValidationError as exc:
        LOGGER.warning(
            "extract_verification: Pydantic validation failed (%s); using lenient fallback",
            exc,
        )
        return _normalize_verification_lenient(
            _parse_llm_json(content, context="extract_verification")
        )
    return payload.model_dump(mode="json")


def _normalize_verification_lenient(data: dict[str, Any]) -> dict[str, Any]:
    """Lenient fallback when VerificationPayload.model_validate_json fails."""
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

    # Round-trip through the model so this path returns the exact same shape
    # as the strict model_validate_json path.
    payload = VerificationPayload.model_validate(
        {"existing_churches": existing, "new_churches": new_churches}
    )
    return payload.model_dump(mode="json")
