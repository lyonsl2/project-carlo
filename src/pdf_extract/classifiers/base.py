"""Classifier protocol for the event-extraction comparison framework.

Each classifier takes a bulletin PDF and a list of known churches, and returns
the same dict shape as schedule_extraction.extract_events:

    {
        "events": [...flat event dicts...],
        "published_date": str | None,   # YYYY-MM-DD
        "wrong_bulletin": bool,
        "church_list_needs_review": bool,
    }

Each event dict uses the schema produced by schedule_extraction.reconstruct_events:
church_slug, type, kind, day_of_week, date, start_time, end_time, cancelled,
page_number, note.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Classifier(Protocol):
    """Pluggable bulletin → events classifier."""

    name: str
    """Stable identifier; used in cache paths and CLI selection (e.g. "gemini-flash")."""

    version: str
    """Bump to invalidate the on-disk cache (e.g. "v1", model id, prompt hash)."""

    def extract(
        self,
        pdf_bytes: bytes,
        *,
        churches: list[dict[str, Any]],
        today: date,
    ) -> dict[str, Any]:
        """Return events for one bulletin."""
        ...
