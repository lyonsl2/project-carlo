"""Extract text from PDF files using PyMuPDF."""

from pathlib import Path

from docling.document_converter import DocumentConverter
import fitz  # PyMuPDF


def extract_text(pdf_path: str | Path) -> str:
    """Extract all text from a PDF file.

    Args:
        pdf_path: Path to the PDF file.

    Returns:
        Concatenated text from all pages, with page breaks preserved.

    Raises:
        FileNotFoundError: If the PDF file does not exist.
        fitz.FileDataError: If the file is not a valid PDF.
    """
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")

    parts: list[str] = []
    doc = fitz.open(path)
    try:
        for page in doc:
            parts.append(page.get_text())
    finally:
        doc.close()

    return "\n".join(parts).strip()


def extract_text_by_page(pdf_path: str | Path) -> list[str]:
    """Extract text from each page of a PDF as a list of strings.

    Args:
        pdf_path: Path to the PDF file.

    Returns:
        List of text strings, one per page.
    """
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")

    doc = fitz.open(path)
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def extract_markdown_with_docling(pdf_path: str | Path) -> str:
    """Convert a PDF to markdown using Docling."""
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")

    converter = DocumentConverter()
    result = converter.convert(str(path))
    return result.document.export_to_markdown().strip()


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF represented as bytes."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return "\n".join(page.get_text() for page in doc).strip()
    finally:
        doc.close()


def extract_text_by_page_from_pdf_bytes(pdf_bytes: bytes) -> list[str]:
    """Extract text by page from a PDF represented as bytes."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def format_pages_with_boundaries(pages: list[str]) -> str:
    """Format page text with explicit boundary markers."""
    parts: list[str] = []
    for idx, page_text in enumerate(pages, start=1):
        text = page_text.strip()
        parts.append(f"[PAGE {idx} START]\n{text}\n[PAGE {idx} END]")
    return "\n\n".join(parts).strip()
