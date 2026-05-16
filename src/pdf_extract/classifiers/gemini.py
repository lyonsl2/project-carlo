"""Gemini classifier: thin adapter over schedule_extraction.extract_events."""

from __future__ import annotations

from datetime import date
from typing import Any

from pdf_extract.schedule_extraction import extract_events


class GeminiClassifier:
    name: str
    version: str
    _model: str

    def __init__(self, *, model: str = "gemini-3-flash-preview", name: str | None = None) -> None:
        self._model = model
        self.name = name or "gemini-flash"
        self.version = model

    def extract(
        self,
        pdf_bytes: bytes,
        *,
        churches: list[dict[str, Any]],
        today: date,
    ) -> dict[str, Any]:
        return extract_events(
            pdf_bytes,
            churches=churches,
            model=self._model,
            today=today,
        )
