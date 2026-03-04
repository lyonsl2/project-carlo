from pdf_extract import extract_events, extract_text, extract_text_by_page, sync_bulletins


def test_public_exports_are_callable() -> None:
    assert callable(extract_text)
    assert callable(extract_text_by_page)
    assert callable(extract_events)
    assert callable(sync_bulletins)
