from datetime import date
from pathlib import Path

from pdf_extract.storage import (
    SCHEMA_PATH,
    connect_db,
)
from pdf_extract.fetch import (
    BulletinLink,
    DISCOVER_MASS_TYPE,
    OTHER_TYPE,
    PARISHES_ONLINE_TYPE,
    _build_bulletin_link,
    _extract_discover_mass_pdf_url_from_href,
    _extract_ecatholic_pdf_url_from_href,
    _extract_parishes_online_pdf_url_from_href,
    _find_other_bulletin_page_url,
    _goto_with_retry,
    _normalize_url_for_request,
    _parse_relaxed_date,
    _resolve_fetch_source,
    _resolve_other_latest_link,
    _next_sunday_after,
    _resolve_latest_anchor_link_with_playwright,
    build_latest_discover_mass_bulletin_links,
    build_latest_ecatholic_bulletin_links,
    build_latest_other_bulletin_links,
    build_latest_parishes_online_bulletin_links,
)


def _create_test_db(db_path: Path) -> None:
    """Create a test database from schema.sql with a test parish."""
    conn = connect_db(db_path)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.execute(
        """INSERT INTO parish(
            slug, name, homepage_url, bulletin_provider, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)""",
        (
            "test-parish",
            "Test Parish",
            "https://test.org",
            "ecatholic",
            None,
            "2026-01-01T00:00:00Z",
        ),
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


def test_build_latest_discover_mass_bulletin_links() -> None:
    class FakePage:
        def goto(self, url: str, wait_until: str) -> None:
            assert url == "https://discovermass.com/church/st-joseph-rush/"
            assert wait_until == "domcontentloaded"

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
            assert selector == "a#bulletin-current[href]"
            assert timeout == 15000
            assert state == "attached"

        def query_selector_all(self, selector: str):
            assert selector == "a#bulletin-current[href]"

            class _Anchor:
                def __init__(self, href):
                    self._href = href

                def get_attribute(self, name: str):
                    if name == "href":
                        return self._href
                    return None

            return [
                _Anchor("/church/st-joseph-rush/"),
                _Anchor("https://bulletins.discovermass.com/download.php?bulletin=abc123"),
            ]

    link = build_latest_discover_mass_bulletin_links(
        provider_id="/st-joseph-rush/",
        page=FakePage(),
    )
    assert link.source_url == "https://bulletins.discovermass.com/download.php?bulletin=abc123"
    assert link.fetch_url == "https://bulletins.discovermass.com/download.php?bulletin=abc123"


def test_build_latest_discover_mass_bulletin_links_raises_when_bulletin_anchor_missing() -> None:
    class FakePage:
        def goto(self, url: str, wait_until: str) -> None:
            assert url == "https://discovermass.com/church/st-joseph-rush/"
            assert wait_until == "domcontentloaded"

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
            assert selector == "a#bulletin-current[href]"
            assert timeout == 15000
            assert state == "attached"

        def query_selector_all(self, selector: str):
            assert selector == "a#bulletin-current[href]"
            return []

    try:
        build_latest_discover_mass_bulletin_links(
            provider_id="st-joseph-rush",
            page=FakePage(),
        )
    except ValueError as exc:
        assert "No matching anchor link found for discover-mass provider_id=st-joseph-rush" in str(exc)
    else:
        raise AssertionError("Expected ValueError when Discover Mass bulletin anchor is missing")


def test_extract_discover_mass_pdf_url_from_href() -> None:
    urls = _extract_discover_mass_pdf_url_from_href(
        href="https://bulletins.discovermass.com/download.php?bulletin=abc123",
        base_url="https://discovermass.com/church/st-joseph-rush/",
    )
    assert urls == (
        "https://bulletins.discovermass.com/download.php?bulletin=abc123",
        "https://bulletins.discovermass.com/download.php?bulletin=abc123",
    )


def test_extract_discover_mass_pdf_url_from_href_rejects_non_download_urls() -> None:
    urls = _extract_discover_mass_pdf_url_from_href(
        href="https://bulletins.discovermass.com/image.php?bulletin=abc123",
        base_url="https://discovermass.com/church/st-joseph-rush/",
    )
    assert urls is None


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

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
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


def test_build_bulletin_link_discover_mass(monkeypatch) -> None:
    def fake_build(*, provider_id, reference_date=None, page=None):
        return BulletinLink(
            source_url="https://discovermass.com/church/st-joseph-rush/",
            fetch_url="https://discovermass.com/church/st-joseph-rush/",
        )

    monkeypatch.setattr("pdf_extract.fetch.build_latest_discover_mass_bulletin_links", fake_build)
    link = _build_bulletin_link(DISCOVER_MASS_TYPE, "st-joseph-rush")
    assert link.fetch_url == "https://discovermass.com/church/st-joseph-rush/"


def test_build_latest_other_bulletin_links(monkeypatch) -> None:
    def fake_resolve(*, provider_id: str, reference_date=None, page=None) -> tuple[str, str]:
        assert provider_id == "https://example.org"
        assert reference_date == date(2026, 2, 19)
        return (
            "https://example.org/bulletins/2026-02-16.pdf",
            "https://example.org/bulletins/2026-02-16.pdf",
        )

    monkeypatch.setattr("pdf_extract.fetch._resolve_other_latest_link", fake_resolve)
    link = build_latest_other_bulletin_links(
        provider_id="https://example.org",
        reference_date=date(2026, 2, 19),
    )
    assert link.source_url == "https://example.org/bulletins/2026-02-16.pdf"
    assert link.fetch_url == "https://example.org/bulletins/2026-02-16.pdf"


def test_find_other_bulletin_page_url_prefers_href_and_text_match() -> None:
    class FakeAnchor:
        def __init__(self, href: str, text: str):
            self._href = href
            self._text = text

        def get_attribute(self, name: str):
            if name == "href":
                return self._href
            return None

        def inner_text(self):
            return self._text

    class FakePage:
        def query_selector_all(self, selector: str):
            assert selector == "a[href]"
            return [
                FakeAnchor("/news", "Parish News"),
                FakeAnchor("/weekly", "Weekly Bulletin"),
                FakeAnchor("/bulletins", "Read Bulletins"),
            ]

    resolved = _find_other_bulletin_page_url(page=FakePage(), base_url="https://example.org")
    assert resolved == "https://example.org/bulletins"


def test_resolve_other_latest_link_prefers_latest_parseable_within_plus_minus_week() -> None:
    class FakeAnchor:
        def __init__(self, href: str, text: str):
            self._href = href
            self._text = text

        def get_attribute(self, name: str):
            if name == "href":
                return self._href
            return None

        def inner_text(self):
            return self._text

    class FakePage:
        def __init__(self):
            self.url = ""

        def goto(self, url: str, wait_until: str) -> None:
            assert wait_until == "domcontentloaded"
            self.url = url

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
            assert selector == "a[href]"
            assert timeout == 15000

        def query_selector_all(self, selector: str):
            assert selector == "a[href]"
            if self.url == "https://example.org":
                return [
                    FakeAnchor("/weekly", "Weekly"),
                    FakeAnchor("/bulletins", "Bulletin Archive"),
                ]
            assert self.url == "https://example.org/bulletins"
            return [
                FakeAnchor("/pdfs/old-2026-01-10.pdf", "Jan 10, 2026 Bulletin"),
                FakeAnchor("/pdfs/new-2026-02-18.pdf", "Feb 18, 2026 Bulletin"),
                FakeAnchor("/pdfs/future-2026-03-10.pdf", "Mar 10, 2026 Bulletin"),
            ]

    source_url, fetch_url = _resolve_other_latest_link(
        provider_id="https://example.org",
        reference_date=date(2026, 2, 19),
        page=FakePage(),
    )
    assert source_url == "https://example.org/pdfs/new-2026-02-18.pdf"
    assert fetch_url == "https://example.org/pdfs/new-2026-02-18.pdf"


def test_resolve_other_latest_link_falls_back_to_first_pdf_when_no_date_match() -> None:
    class FakeAnchor:
        def __init__(self, href: str, text: str):
            self._href = href
            self._text = text

        def get_attribute(self, name: str):
            if name == "href":
                return self._href
            return None

        def inner_text(self):
            return self._text

    class FakePage:
        def __init__(self):
            self.url = ""

        def goto(self, url: str, wait_until: str) -> None:
            self.url = url

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
            assert selector == "a[href]"
            assert timeout == 15000

        def query_selector_all(self, selector: str):
            assert selector == "a[href]"
            if self.url == "https://example.org":
                return [FakeAnchor("/bulletins", "Bulletin Archive")]
            return [
                FakeAnchor("/pdfs/no-date-1.pdf", "This Week"),
                FakeAnchor("/pdfs/no-date-2.pdf", "Latest PDF"),
            ]

    source_url, fetch_url = _resolve_other_latest_link(
        provider_id="https://example.org",
        reference_date=date(2026, 2, 19),
        page=FakePage(),
    )
    assert source_url == "https://example.org/pdfs/no-date-1.pdf"
    assert fetch_url == "https://example.org/pdfs/no-date-1.pdf"


def test_resolve_other_latest_link_finds_pdf_embedded_in_script_on_post_page() -> None:
    """Mirrors the elmiracatholic.org layout: the per-week post page does not
    expose the bulletin PDF as an <a> or <iframe>; it is embedded as a JSON
    string (JSON-escaped slashes) inside a WordPress dflip / 3D FlipBook script.
    The resolver should still pick it up via the rendered HTML.
    """

    class FakeAnchor:
        def __init__(self, href: str, text: str):
            self._href = href
            self._text = text

        def get_attribute(self, name: str):
            if name == "href":
                return self._href
            return None

        def inner_text(self):
            return self._text

    listing_url = "https://elmiracatholic.org/news-bulletins/"
    latest_post_url = "https://elmiracatholic.org/2026/04/16/april-19-2026-bulletin/"
    expected_pdf_url = (
        "https://elmiracatholic.org/wp-content/uploads/2026/04/"
        "ElmiraCatholicChurchesBulletin-4-19-2026.pdf"
    )
    dflip_script = (
        '<div class="_df_book" id="df_10896"></div>'
        '<script class="df-shortcode-script" type="application/javascript">'
        'window.option_df_10896 = {"source":'
        '"https:\\/\\/elmiracatholic.org\\/wp-content\\/uploads\\/2026\\/04\\/'
        'ElmiraCatholicChurchesBulletin-4-19-2026.pdf","wpOptions":"true"};'
        '</script>'
    )

    class FakePage:
        def __init__(self):
            self.url = ""

        def goto(self, url: str, wait_until: str) -> None:
            assert wait_until == "domcontentloaded"
            self.url = url

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
            assert selector == "a[href]"
            assert timeout == 15000

        def query_selector_all(self, selector: str):
            assert selector == "a[href]"
            if self.url == "https://elmiracatholic.org":
                return [FakeAnchor("/news-bulletins/", "News/Bulletins")]
            if self.url == listing_url:
                return [
                    FakeAnchor(latest_post_url, "April 19, 2026 Bulletin"),
                ]
            assert self.url == latest_post_url
            return [FakeAnchor("https://elmiracatholic.org/", "Home")]

        def content(self) -> str:
            if self.url == latest_post_url:
                return f"<html><body>{dflip_script}</body></html>"
            return "<html><body></body></html>"

    source_url, fetch_url = _resolve_other_latest_link(
        provider_id="https://elmiracatholic.org",
        reference_date=date(2026, 4, 17),
        page=FakePage(),
    )
    assert source_url == expected_pdf_url
    assert fetch_url == expected_pdf_url


def test_resolve_other_latest_link_descends_into_latest_bulletin_post_when_no_pdfs() -> None:
    """Listing pages that link to dated bulletin *posts* (not PDFs) should resolve
    by navigating into the latest-dated post and collecting the PDF there.

    Mirrors the elmiracatholic.org WordPress-style layout where /news-bulletins/
    lists permalink posts like /2026/04/16/april-192026-bulletin/ which wrap
    the actual PDF.
    """

    class FakeAnchor:
        def __init__(self, href: str, text: str):
            self._href = href
            self._text = text

        def get_attribute(self, name: str):
            if name == "href":
                return self._href
            return None

        def inner_text(self):
            return self._text

    listing_url = "https://elmiracatholic.org/news-bulletins/"
    latest_post_url = "https://elmiracatholic.org/2026/04/16/april-19-2026-bulletin/"
    older_post_url = "https://elmiracatholic.org/2026/04/09/april-12-2026-bulletin/"
    latest_pdf_url = (
        "https://elmiracatholic.org/wp-content/uploads/2026/04/"
        "ElmiraCatholicChurchesBulletin-4-19-2026.pdf"
    )

    class FakePage:
        def __init__(self):
            self.url = ""

        def goto(self, url: str, wait_until: str) -> None:
            assert wait_until == "domcontentloaded"
            self.url = url

        def wait_for_selector(self, selector: str, timeout: int, state=None) -> None:
            assert selector == "a[href]"
            assert timeout == 15000

        def query_selector_all(self, selector: str):
            assert selector == "a[href]"
            if self.url == "https://elmiracatholic.org":
                return [FakeAnchor("/news-bulletins/", "News/Bulletins")]
            if self.url == listing_url:
                return [
                    FakeAnchor(listing_url, "News/Bulletins"),
                    FakeAnchor(latest_post_url, "April 19, 2026 Bulletin"),
                    FakeAnchor(older_post_url, "April 12, 2026 Bulletin"),
                    FakeAnchor("/category/bulletin/", "Bulletin"),
                ]
            assert self.url == latest_post_url
            return [FakeAnchor(latest_pdf_url, "Download Bulletin")]

    source_url, fetch_url = _resolve_other_latest_link(
        provider_id="https://elmiracatholic.org",
        reference_date=date(2026, 4, 17),
        page=FakePage(),
    )
    assert source_url == latest_pdf_url
    assert fetch_url == latest_pdf_url


def test_build_bulletin_link_other(monkeypatch) -> None:
    def fake_build(*, provider_id, reference_date=None, page=None):
        assert provider_id == "https://example.org"
        return BulletinLink(source_url="https://example.org/weekly.pdf", fetch_url="https://example.org/weekly.pdf")

    monkeypatch.setattr("pdf_extract.fetch.build_latest_other_bulletin_links", fake_build)
    link = _build_bulletin_link(OTHER_TYPE, "https://example.org")
    assert link.fetch_url == "https://example.org/weekly.pdf"


def test_parse_relaxed_date_handles_multiple_formats() -> None:
    ref = date(2026, 2, 19)
    assert _parse_relaxed_date("Bulletin Feb 18, 2026", ref) == date(2026, 2, 18)
    assert _parse_relaxed_date("Bulletin 02/18/26", ref) == date(2026, 2, 18)
    assert _parse_relaxed_date("Bulletin 2026-02-18", ref) == date(2026, 2, 18)


def test_normalize_url_for_request_encodes_spaces() -> None:
    raw = "https://s3-us-west-2.amazonaws.com/classrooms.stritawebster.org/Bulletins/2026/March 22.pdf"
    normalized = _normalize_url_for_request(raw)
    assert normalized.endswith("/March%2022.pdf")


def test_goto_with_retry_on_interrupted_navigation() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.calls = 0
            self.waits = 0

        def goto(self, page_url: str, wait_until: str) -> None:
            self.calls += 1
            assert page_url == "https://example.org/page"
            assert wait_until == "domcontentloaded"
            if self.calls == 1:
                raise Exception(
                    'Page.goto: Navigation to "https://example.org/page" is interrupted by another navigation'
                )

        def wait_for_timeout(self, ms: int) -> None:
            assert ms == 250
            self.waits += 1

    page = FakePage()
    _goto_with_retry(page=page, page_url="https://example.org/page")
    assert page.calls == 2
    assert page.waits == 1


def test_resolve_fetch_source_discover_mass_uses_provider_id() -> None:
    parish = {
        "bulletin_provider": DISCOVER_MASS_TYPE,
        "provider_id": "st-joseph-rush",
        "homepage_url": "https://stjoseph.example.org",
    }
    assert _resolve_fetch_source(parish) == (DISCOVER_MASS_TYPE, "st-joseph-rush")


def test_resolve_fetch_source_discover_mass_without_provider_id_returns_none() -> None:
    parish = {
        "bulletin_provider": DISCOVER_MASS_TYPE,
        "provider_id": "",
        "homepage_url": "https://stjoseph.example.org",
    }
    assert _resolve_fetch_source(parish) is None
