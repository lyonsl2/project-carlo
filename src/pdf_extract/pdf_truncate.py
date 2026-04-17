"""Cap bulletin PDFs at a maximum page count before sending to Gemini."""

from __future__ import annotations

import logging
from pathlib import Path

from pypdf import PdfReader, PdfWriter

LOGGER = logging.getLogger(__name__)

MAX_BULLETIN_PAGES = 10


def _truncated_path(pdf_path: Path) -> Path:
    return pdf_path.with_name(f"{pdf_path.stem}-truncated{pdf_path.suffix}")


def _page_count(pdf_path: Path) -> int:
    reader = PdfReader(str(pdf_path))
    return len(reader.pages)


def ensure_truncated_pdf(pdf_path: Path, *, max_pages: int = MAX_BULLETIN_PAGES) -> Path:
    """Return a path to a PDF with at most ``max_pages`` pages.

    If ``pdf_path`` has ``<= max_pages`` pages, returns ``pdf_path`` unchanged.
    Otherwise writes/returns ``<stem>-truncated.pdf`` next to the original
    containing only the first ``max_pages`` pages. Re-uses an existing
    truncated file whose page count already matches ``max_pages``.
    """
    original_pages = _page_count(pdf_path)
    if original_pages <= max_pages:
        return pdf_path

    target = _truncated_path(pdf_path)
    if target.exists():
        try:
            if _page_count(target) == max_pages:
                return target
        except Exception:
            LOGGER.warning(
                "Existing truncated PDF unreadable, regenerating: %s", target, exc_info=True,
            )

    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    for page in reader.pages[:max_pages]:
        writer.add_page(page)
    with target.open("wb") as fh:
        writer.write(fh)

    LOGGER.info(
        "Truncated bulletin from %d to %d pages: %s -> %s",
        original_pages, max_pages, pdf_path, target,
    )
    return target
