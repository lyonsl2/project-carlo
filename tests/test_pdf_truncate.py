from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdf_extract.pdf_truncate import ensure_truncated_pdf


def _make_pdf(path: Path, pages: int) -> None:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    with path.open("wb") as fh:
        writer.write(fh)


def _page_count(path: Path) -> int:
    return len(PdfReader(str(path)).pages)


def test_truncates_when_over_limit(tmp_path: Path) -> None:
    original = tmp_path / "bulletin.pdf"
    _make_pdf(original, pages=12)

    result = ensure_truncated_pdf(original)

    expected = tmp_path / "bulletin-truncated.pdf"
    assert result == expected
    assert expected.exists()
    assert _page_count(expected) == 10
    assert _page_count(original) == 12


def test_returns_original_when_at_or_under_limit(tmp_path: Path) -> None:
    original = tmp_path / "bulletin.pdf"
    _make_pdf(original, pages=8)

    result = ensure_truncated_pdf(original)

    assert result == original
    assert not (tmp_path / "bulletin-truncated.pdf").exists()


def test_is_idempotent_on_subsequent_calls(tmp_path: Path) -> None:
    original = tmp_path / "bulletin.pdf"
    _make_pdf(original, pages=15)

    first = ensure_truncated_pdf(original)
    first_mtime = first.stat().st_mtime_ns

    second = ensure_truncated_pdf(original)

    assert second == first
    assert second.stat().st_mtime_ns == first_mtime
    assert _page_count(second) == 10


def test_custom_max_pages(tmp_path: Path) -> None:
    original = tmp_path / "bulletin.pdf"
    _make_pdf(original, pages=6)

    result = ensure_truncated_pdf(original, max_pages=3)

    expected = tmp_path / "bulletin-truncated.pdf"
    assert result == expected
    assert _page_count(expected) == 3
