from datetime import date
from pathlib import Path

from pdf_extract.storage import (
    SCHEMA_PATH,
    connect_db,
    list_churches,
)
from pdf_extract.fetch import (
    BulletinLink,
    PARISHES_ONLINE_TYPE,
    _build_bulletin_link,
    _extract_ecatholic_pdf_url_from_href,
    _extract_parishes_online_pdf_url_from_href,
    _next_sunday_after,
    _resolve_latest_anchor_link_with_playwright,
    build_latest_ecatholic_bulletin_links,
    build_latest_parishes_online_bulletin_links,
)
from pdf_extract.process import (
    _find_matching_church,
    normalize_church_name,
)


def _create_test_db(db_path: Path) -> None:
    """Create a test database from schema.sql with a test parish."""
    conn = connect_db(db_path)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.execute(
        "INSERT INTO parish(slug, name, source_type, source_provider_id, created_at) VALUES (?, ?, ?, ?, ?)",
        ("test-parish", "Test Parish", "ecatholic", "https://test.org", "2026-01-01T00:00:00Z"),
    )
    conn.commit()
    conn.close()


def test_build_latest_ecatholic_bulletin_links(monkeypatch) -> None:
    def fake_resolve(*, provider_id: str, page=None) -> tuple[str, str]:
        assert provider_id == "https://southeastrochestercatholics.org"
        return (
            "https://files.ecatholic.com/19887/bulletins/20260222.pdf",
            "https://files.ecatholic.com/19887/bulletins/20260222.pdf",
        )

    monkeypatch.setattr("pdf_extract.fetch._resolve_ecatholic_latest_link", fake_resolve)
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


def test_build_latest_parishes_online_bulletin_links(monkeypatch) -> None:
    def fake_resolve(*, provider_id: str, page=None) -> tuple[str, str]:
        assert provider_id == "123"
        return (
            "https://parishesonline.com/publication-page/123?selectedPublication=https://container.parishesonline.com/path/latest.pdf",
            "https://container.parishesonline.com/path/latest.pdf",
        )

    monkeypatch.setattr("pdf_extract.fetch._resolve_parishes_online_latest_link", fake_resolve)
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


def test_resolve_latest_anchor_link_with_playwright_uses_first_valid_anchor() -> None:
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

    fake_page = FakePage()
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
        page=fake_page,
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


def test_find_matching_church_by_name_similarity() -> None:
    churches = [
        {
            "parish_slug": "test-parish",
            "name": "St Mary's",
            "address": "15 St Mary's Place",
            "name_normalized": "saint mary s",
            "latitude": None,
            "longitude": None,
        }
    ]
    # Similar name should match
    match = _find_matching_church(churches, "test-parish", "saint mary", None)
    assert match is not None
    assert match["name_normalized"] == "saint mary s"


def test_find_matching_church_by_address() -> None:
    churches = [
        {
            "parish_slug": "test-parish",
            "name": "Blessed Sacrament Church",
            "address": "534 Oxford St., Rochester, NY 14607",
            "name_normalized": "blessed sacrament",
            "latitude": None,
            "longitude": None,
        }
    ]
    # Same address (different punctuation) should match
    match = _find_matching_church(churches, "test-parish", "blessed sacrament", "534 Oxford St Rochester NY 14607")
    assert match is not None
    assert match["name"] == "Blessed Sacrament Church"


def test_find_matching_church_no_match() -> None:
    churches = [
        {
            "parish_slug": "test-parish",
            "name": "St Mary's",
            "address": None,
            "name_normalized": "saint mary s",
            "latitude": None,
            "longitude": None,
        }
    ]
    match = _find_matching_church(churches, "test-parish", "holy cross", None)
    assert match is None


def test_find_matching_church_wrong_parish() -> None:
    churches = [
        {
            "parish_slug": "other-parish",
            "name": "St Mary's",
            "address": None,
            "name_normalized": "saint mary s",
            "latitude": None,
            "longitude": None,
        }
    ]
    match = _find_matching_church(churches, "test-parish", "saint mary s", None)
    assert match is None


def test_build_bulletin_link_ecatholic(monkeypatch) -> None:
    def fake_build(*, provider_id, reference_date=None, page=None):
        return BulletinLink(source_url="https://ecatholic.com/b.pdf", fetch_url="https://ecatholic.com/b.pdf")

    monkeypatch.setattr("pdf_extract.fetch.build_latest_ecatholic_bulletin_links", fake_build)
    link = _build_bulletin_link("ecatholic", "https://test.org")
    assert link.source_url == "https://ecatholic.com/b.pdf"


def test_build_bulletin_link_parishes_online(monkeypatch) -> None:
    def fake_build(*, provider_id, reference_date=None, page=None):
        return BulletinLink(source_url="https://po.com/source", fetch_url="https://po.com/fetch.pdf")

    monkeypatch.setattr("pdf_extract.fetch.build_latest_parishes_online_bulletin_links", fake_build)
    link = _build_bulletin_link(PARISHES_ONLINE_TYPE, "123")
    assert link.fetch_url == "https://po.com/fetch.pdf"
