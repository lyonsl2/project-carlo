"""OpenAI gpt-5.4-mini classifier.

Uses the Responses API with a base64 PDF input_file and a Pydantic-typed
structured output (text_format=SchedulePayload). Reuses the prompt and the
flat-event normalizer from schedule_extraction so output shape matches the
Gemini classifier exactly.

Module is named openai_gpt.py (not openai.py) to avoid shadowing the upstream
`openai` package.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import date
from typing import Any

from openai import OpenAI

from pdf_extract.schedule_extraction import (
    EVENTS_SYSTEM_PROMPT,
    SchedulePayload,
    reconstruct_events,
)

LOGGER = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-5.4-mini"


class OpenAIClassifier:
    name: str
    version: str
    _model: str

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        name: str | None = None,
        max_retries: int = 5,
    ) -> None:
        self._model = model
        self._max_retries = max_retries
        self.name = name or model
        self.version = model

    def extract(
        self,
        pdf_bytes: bytes,
        *,
        churches: list[dict[str, Any]],
        today: date,
    ) -> dict[str, Any]:
        if not pdf_bytes:
            return reconstruct_events({})

        prompt = EVENTS_SYSTEM_PROMPT.format(
            churches_json=json.dumps(churches, ensure_ascii=False),
            today_iso=today.isoformat(),
            today_day_of_week=today.strftime("%A"),
        )
        encoded = base64.b64encode(pdf_bytes).decode("ascii")

        # The SDK retries 429 / 5xx responses internally; bump the budget.
        client = OpenAI(max_retries=self._max_retries)
        response = client.responses.parse(
            model=self._model,
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_file",
                            "filename": "bulletin.pdf",
                            "file_data": f"data:application/pdf;base64,{encoded}",
                        },
                        {
                            "type": "input_text",
                            "text": prompt,
                        },
                    ],
                }
            ],
            text_format=SchedulePayload,
        )

        parsed = response.output_parsed
        if parsed is None:
            # Refusal or schema mismatch — log and degrade to empty result so the
            # bulletin shows up in the run as zero-events rather than crashing.
            LOGGER.warning(
                "OpenAI %s returned no parsed output; treating as empty bulletin",
                self._model,
            )
            return reconstruct_events({})

        return reconstruct_events(parsed.model_dump())
