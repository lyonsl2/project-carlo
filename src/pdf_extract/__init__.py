"""Fetch and process parish bulletins into schedule events."""

from pdf_extract.fetch import fetch_bulletins
from pdf_extract.process import process_bulletins
from pdf_extract.schedule_extraction import extract_events
from pdf_extract.verify import verify_churches

__all__ = [
    "extract_events",
    "fetch_bulletins",
    "process_bulletins",
    "verify_churches",
]
