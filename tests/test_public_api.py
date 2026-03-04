from pdf_extract import extract_events, fetch_bulletins, process_bulletins, sync_bulletins


def test_public_exports_are_callable() -> None:
    assert callable(extract_events)
    assert callable(fetch_bulletins)
    assert callable(process_bulletins)
    assert callable(sync_bulletins)
