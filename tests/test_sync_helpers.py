from datetime import date
from pathlib import Path

from pdf_extract.storage import (
    connect_db,
    get_parish_id,
    list_churches,
    migrate_db,
)
from pdf_extract.sync import (
    BulletinLink,
    PARISHES_ONLINE_TYPE,
    _extract_ecatholic_pdf_url_from_href,
    _extract_parishes_online_pdf_url_from_href,
    _build_latest_bulletin_links_for_parish,
    _next_sunday_after,
    _resolve_latest_anchor_link_from_html_fetch,
    _resolve_latest_anchor_link_with_playwright,
    _resolve_church_id,
    build_latest_ecatholic_bulletin_links,
    build_latest_parishes_online_bulletin_links,
    normalize_church_name,
)


def test_build_latest_ecatholic_bulletin_links(monkeypatch) -> None:
    def fake_resolve(*, provider_id: str) -> tuple[str, str]:
        assert provider_id == "https://southeastrochestercatholics.org"
        return (
            "https://files.ecatholic.com/19887/bulletins/20260222.pdf",
            "https://files.ecatholic.com/19887/bulletins/20260222.pdf",
        )

    monkeypatch.setattr("pdf_extract.sync._resolve_ecatholic_latest_link", fake_resolve)
    link = build_latest_ecatholic_bulletin_links(
        provider_id="https://southeastrochestercatholics.org",
        reference_date=date(2026, 2, 19),  # should be ignored
    )
    assert link.source_url == "https://files.ecatholic.com/19887/bulletins/20260222.pdf"
    assert link.fetch_url == "https://files.ecatholic.com/19887/bulletins/20260222.pdf"


def test_extract_ecatholic_pdf_url_from_href() -> None:
    urls = _extract_ecatholic_pdf_url_from_href(
        href="/19887/bulletins/20260222.pdf",
        base_url="https://files.ecatholic.com",
    )
    assert urls == (
        "https://files.ecatholic.com/19887/bulletins/20260222.pdf",
        "https://files.ecatholic.com/19887/bulletins/20260222.pdf",
    )


def test_resolve_latest_anchor_link_from_html_fetch_uses_first_valid_anchor(monkeypatch) -> None:
    html = b"""
    <html>
      <body>
        <a href="/ignore-this">Ignore</a>
        <a href="/good.pdf">Good</a>
        <a href="/later.pdf">Later</a>
      </body>
    </html>
    """

    def fake_http_get_bytes(url: str, *, referer=None, timeout=60) -> bytes:
        assert url == "https://example.org/bulletins"
        assert timeout == 30
        return html

    monkeypatch.setattr("pdf_extract.sync._http_get_bytes", fake_http_get_bytes)

    seen_hrefs: list[str] = []

    def href_to_urls(href: str):
        seen_hrefs.append(href)
        if href == "/good.pdf":
            return ("https://example.org/source", "https://example.org/good.pdf")
        return None

    source_url, fetch_url = _resolve_latest_anchor_link_from_html_fetch(
        page_url="https://example.org/bulletins",
        source_label="test-provider",
        href_filter=lambda href: "pdf" in href,
        href_to_urls=href_to_urls,
    )
    assert seen_hrefs == ["/good.pdf"]
    assert source_url == "https://example.org/source"
    assert fetch_url == "https://example.org/good.pdf"


def test_build_latest_parishes_online_bulletin_links(monkeypatch) -> None:
    def fake_resolve(*, provider_id: str) -> tuple[str, str]:
        assert provider_id == "123"
        return (
            "https://parishesonline.com/publication-page/123?selectedPublication=https://container.parishesonline.com/path/latest.pdf",
            "https://container.parishesonline.com/path/latest.pdf",
        )

    monkeypatch.setattr("pdf_extract.sync._resolve_parishes_online_latest_link", fake_resolve)
    link = build_latest_parishes_online_bulletin_links(
        provider_id="123",
        reference_date=date(2026, 2, 19),
    )
    assert link.fetch_url == "https://container.parishesonline.com/path/latest.pdf"


def test_extract_parishes_online_pdf_url_from_absolute_href() -> None:
    href = (
        "https://parishesonline.com/publication-page/abc-123?"
        "selectedPublication=https%3A%2F%2Fcontainer.parishesonline.com%2Fpath%2Flatest.pdf"
    )
    urls = _extract_parishes_online_pdf_url_from_href(
        href=href,
        provider_id="abc-123",
        base_url="https://parishesonline.com/organization/abc-123",
    )
    assert urls == (
        "https://parishesonline.com/publication-page/abc-123?"
        "selectedPublication=https%3A%2F%2Fcontainer.parishesonline.com%2Fpath%2Flatest.pdf",
        "https://container.parishesonline.com/path/latest.pdf",
    )


def test_extract_parishes_online_pdf_url_from_relative_href() -> None:
    href = (
        "/publication-page/our-lady-of-lourdes-saint-anne-church?"
        "selectedPublication=https%3A%2F%2Fcontainer.parishesonline.com%2Fbulletins%2Fweekly.pdf"
    )
    urls = _extract_parishes_online_pdf_url_from_href(
        href=href,
        provider_id="our-lady-of-lourdes-saint-anne-church",
        base_url="https://parishesonline.com/organization/our-lady-of-lourdes-saint-anne-church",
    )
    assert urls == (
        "https://parishesonline.com/publication-page/our-lady-of-lourdes-saint-anne-church?"
        "selectedPublication=https%3A%2F%2Fcontainer.parishesonline.com%2Fbulletins%2Fweekly.pdf",
        "https://container.parishesonline.com/bulletins/weekly.pdf",
    )


def test_resolve_latest_anchor_link_with_playwright_uses_first_valid_anchor(monkeypatch) -> None:
    class FakeAnchor:
        def __init__(self, href):
            self._href = href

        def get_attribute(self, name: str):
            if name == "href":
                return self._href
            return None

    class FakePage:
        def goto(self, url: str, wait_until: str) -> None:
            assert url == "https://example.org/bulletins"
            assert wait_until == "domcontentloaded"

        def wait_for_selector(self, selector: str, timeout: int) -> None:
            assert selector == "a[href*='bulletins']"
            assert timeout == 15000

        def query_selector_all(self, selector: str):
            assert selector == "a[href*='bulletins']"
            return [
                FakeAnchor(None),
                FakeAnchor("/ignore-this"),
                FakeAnchor("/good.pdf"),
                FakeAnchor("/later.pdf"),
            ]

    class FakeBrowser:
        def new_page(self) -> FakePage:
            return FakePage()

        def close(self) -> None:
            return

    class FakeChromium:
        def launch(self, headless: bool) -> FakeBrowser:
            assert headless is True
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightContext:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, exc_type, exc, tb) -> None:
            return

    class FakePlaywrightModule:
        @staticmethod
        def sync_playwright() -> FakePlaywrightContext:
            return FakePlaywrightContext()

    monkeypatch.setattr(
        "pdf_extract.sync.importlib.import_module",
        lambda name: FakePlaywrightModule(),
    )

    seen_hrefs: list[str] = []

    def href_to_urls(href: str):
        seen_hrefs.append(href)
        if href == "/good.pdf":
            return ("https://example.org/source", "https://example.org/good.pdf")
        return None

    source_url, fetch_url = _resolve_latest_anchor_link_with_playwright(
        page_url="https://example.org/bulletins",
        anchor_selector="a[href*='bulletins']",
        source_label="test-provider",
        href_to_urls=href_to_urls,
    )
    assert seen_hrefs == ["/ignore-this", "/good.pdf"]
    assert source_url == "https://example.org/source"
    assert fetch_url == "https://example.org/good.pdf"


def test_next_sunday_after() -> None:
    assert _next_sunday_after(date(2026, 2, 19)) == date(2026, 2, 22)  # Thursday -> same-week Sunday
    assert _next_sunday_after(date(2026, 2, 22)) == date(2026, 3, 1)   # Sunday -> next Sunday


def test_normalize_church_name() -> None:
    assert normalize_church_name("St Mary's") == "saint mary s"
    assert normalize_church_name("st mary") == "saint mary"
    assert normalize_church_name("Blessed Sacrament Church") == "blessed sacrament"


def test_resolve_church_id_similarity(tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    conn = connect_db(db_path)
    try:
        parish_id = get_parish_id(conn, "Southeast Rochester Catholic Community")
        first_id = _resolve_church_id(
            conn=conn,
            parish_id=parish_id,
            church_name="St Mary's",
            church_address="15 St Mary's Place",
        )
        second_id = _resolve_church_id(
            conn=conn,
            parish_id=parish_id,
            church_name="St Mary",
            church_address=None,
        )
        assert first_id == second_id
        rows = list_churches(conn, parish_id)
        assert len(rows) == 1
    finally:
        conn.close()


def test_build_links_for_parish_parishes_online(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    conn = connect_db(db_path)
    try:
        parish_id = get_parish_id(conn, "Southeast Rochester Catholic Community")
        conn.execute(
            "UPDATE parish SET source_type = ?, source_provider_id = ? WHERE id = ?",
            (PARISHES_ONLINE_TYPE, "123", parish_id),
        )
        conn.commit()

        def fake_build(*, provider_id: str, reference_date=None):
            assert provider_id == "123"
            return BulletinLink(
                source_url="https://parishesonline.com/source.pdf",
                fetch_url="https://container.parishesonline.com/source.pdf",
            )

        monkeypatch.setattr(
            "pdf_extract.sync.build_latest_parishes_online_bulletin_links",
            fake_build,
        )
        link = _build_latest_bulletin_links_for_parish(conn=conn, parish_id=parish_id)
        assert link.source_url == "https://parishesonline.com/source.pdf"
        assert link.fetch_url == "https://container.parishesonline.com/source.pdf"
    finally:
        conn.close()


def test_resolve_church_id_by_address_match(tmp_path: Path) -> None:
    db_path = tmp_path / "parish_events.db"
    migrate_db(db_path)
    conn = connect_db(db_path)
    try:
        parish_id = get_parish_id(conn, "Southeast Rochester Catholic Community")
        first_id = _resolve_church_id(
            conn=conn,
            parish_id=parish_id,
            church_name="Blessed Sacrament Church",
            church_address="534 Oxford St., Rochester, NY 14607",
        )
        second_id = _resolve_church_id(
            conn=conn,
            parish_id=parish_id,
            church_name="Blessed Sacrament",
            church_address="534 Oxford St Rochester NY 14607",
        )
        assert first_id == second_id
        rows = list_churches(conn, parish_id)
        assert len(rows) == 1
    finally:
        conn.close()
