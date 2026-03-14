"""Bulletin fetch pipeline: resolve provider links, download PDFs, save metadata."""

from __future__ import annotations

import hashlib
import importlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from pdf_extract.storage import (
    BULLETINS_DIR,
    BULLETINS_METADATA_PATH,
    connect_db,
    get_parish_by_name,
    list_parishes,
    load_json_list,
    save_json_list,
    utc_now_iso,
)

ECATHOLIC_BULLETINS_PATH = "/bulletins"
PARISHES_ONLINE_TYPE = "parishes-online"
PARISHES_ONLINE_ORG_URL_TEMPLATE = "https://parishesonline.com/organization/{provider_id}"
PARISHES_ONLINE_PUBLICATION_URL_PREFIX = (
    "https://parishesonline.com/publication-page/{provider_id}?selectedPublication="
)
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class BulletinLink:
    source_url: str
    fetch_url: str


def _first_sunday_on_or_after(d: date) -> date:
    return d + timedelta(days=(6 - d.weekday()) % 7)


def _next_sunday_after(d: date) -> date:
    return _first_sunday_on_or_after(d + timedelta(days=1))


# ── eCatholic bulletin resolution ───────────────────────────────────────────

def build_latest_ecatholic_bulletin_links(
    *, provider_id: str, reference_date: date | None = None, page: object | None = None,
) -> BulletinLink:
    _ = reference_date
    source_url, fetch_url = _resolve_ecatholic_latest_link(provider_id=provider_id, page=page)
    return BulletinLink(source_url=source_url, fetch_url=fetch_url)


def _resolve_ecatholic_latest_link(
    *, provider_id: str, page: object | None = None,
) -> tuple[str, str]:
    bulletins_url = urljoin(provider_id.rstrip("/") + "/", ECATHOLIC_BULLETINS_PATH.lstrip("/"))
    return _resolve_latest_anchor_link_with_playwright(
        page_url=bulletins_url,
        anchor_selector="a[href*='files.ecatholic.com']",
        source_label=f"ecatholic provider_id={provider_id}",
        href_to_urls=lambda href: _extract_ecatholic_pdf_url_from_href(
            href=href,
            base_url=bulletins_url,
        ),
        page=page,
    )


def _resolve_parishes_online_latest_link(
    *, provider_id: str, page: object | None = None,
) -> tuple[str, str]:
    org_url = PARISHES_ONLINE_ORG_URL_TEMPLATE.format(provider_id=provider_id)
    return _resolve_latest_anchor_link_with_playwright(
        page_url=org_url,
        anchor_selector="a[href*='selectedPublication=']",
        source_label=f"parishes-online provider_id={provider_id}",
        href_to_urls=lambda href: _extract_parishes_online_pdf_url_from_href(
            href=href,
            provider_id=provider_id,
            base_url=org_url,
        ),
        page=page,
    )


def _launch_browser() -> tuple[object, object, object]:
    """Launch a Playwright browser with stealth. Returns (playwright, browser, page)."""
    playwright_module = importlib.import_module("playwright.sync_api")
    sync_playwright = getattr(playwright_module, "sync_playwright")
    stealth_cls = getattr(importlib.import_module("playwright_stealth"), "Stealth")
    stealth = stealth_cls()

    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=False, channel="chrome")
    context = browser.new_context()
    stealth.apply_stealth_sync(context)
    page = context.new_page()
    return pw, browser, page


def _resolve_latest_anchor_link_with_playwright(
    *,
    page_url: str,
    anchor_selector: str,
    source_label: str,
    href_to_urls: Callable[[str], tuple[str, str] | None],
    page: object | None = None,
) -> tuple[str, str]:
    owns_browser = page is None
    pw = None
    browser = None
    if owns_browser:
        pw, browser, page = _launch_browser()

    try:
        LOGGER.info("Resolving latest anchor link (%s)", source_label)
        LOGGER.info("Visiting page URL: %s", page_url)
        page.goto(page_url, wait_until="domcontentloaded")  # type: ignore[union-attr]
        page.wait_for_selector(anchor_selector, timeout=15000)  # type: ignore[union-attr]
        anchors = page.query_selector_all(anchor_selector)  # type: ignore[union-attr]
        for anchor in anchors:
            href = anchor.get_attribute("href")
            if not isinstance(href, str):
                continue
            urls = href_to_urls(href)
            if urls is None:
                continue
            LOGGER.info("Resolved latest anchor link (%s)", source_label)
            return urls
    finally:
        if owns_browser:
            if browser is not None:
                browser.close()
            if pw is not None:
                pw.stop()

    raise ValueError(f"No matching anchor link found for {source_label} at {page_url}")


def _extract_ecatholic_pdf_url_from_href(*, href: str, base_url: str) -> tuple[str, str] | None:
    absolute_href = urljoin(base_url, href)
    parsed = urlparse(absolute_href)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if host != "files.ecatholic.com":
        return None
    if "bulletins" not in path:
        return None
    if not path.endswith(".pdf"):
        return None
    return absolute_href, absolute_href


def build_latest_parishes_online_bulletin_links(
    *, provider_id: str, reference_date: date | None = None, page: object | None = None,
) -> BulletinLink:
    source_url, fetch_url = _resolve_parishes_online_latest_link(provider_id=provider_id, page=page)
    _ = reference_date
    return BulletinLink(source_url=source_url, fetch_url=fetch_url)


def _extract_parishes_online_pdf_url_from_href(
    *, href: str, provider_id: str, base_url: str
) -> tuple[str, str] | None:
    absolute_href = urljoin(base_url, href)
    parsed = urlparse(absolute_href)
    expected_path = f"/publication-page/{provider_id}"
    if parsed.netloc != "parishesonline.com" or parsed.path != expected_path:
        return None
    selected_values = parse_qs(parsed.query).get("selectedPublication")
    if not selected_values:
        return None
    selected = selected_values[0]
    for _ in range(2):
        selected = unquote(selected)
    if not selected.lower().startswith("https://container.parishesonline.com/"):
        return None
    if not selected.lower().endswith(".pdf"):
        return None
    return absolute_href, selected


# ── Bulletin link resolution ────────────────────────────────────────────────

def _build_bulletin_link(
    source_type: str, source_provider_id: str, *, page: object | None = None,
) -> BulletinLink:
    if source_type == "ecatholic":
        return build_latest_ecatholic_bulletin_links(provider_id=source_provider_id, page=page)
    if source_type == PARISHES_ONLINE_TYPE:
        return build_latest_parishes_online_bulletin_links(provider_id=source_provider_id, page=page)
    raise ValueError(f"Unsupported source_type: {source_type}")


# ── HTTP helpers ────────────────────────────────────────────────────────────

def _http_get_bytes(url: str, *, referer: str | None = None, timeout: int = 60) -> bytes:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "*/*",
    }
    if referer:
        headers["Referer"] = referer
    req = Request(url, headers=headers)
    LOGGER.info("Fetching URL: %s", url)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except HTTPError:
        raise
    except URLError:
        raise


def _download_pdf(*, fetch_url: str, source_url: str) -> bytes:
    referer = source_url
    try:
        LOGGER.info("Attempting primary fetch URL: %s", fetch_url)
        return _http_get_bytes(fetch_url, referer=referer, timeout=60)
    except Exception:
        LOGGER.warning("Primary fetch failed, falling back to source URL: %s", source_url)
        return _http_get_bytes(source_url, referer=referer, timeout=60)


# ── Pipeline: fetch ─────────────────────────────────────────────────────────

def fetch_bulletins(
    *,
    parish_name: str | None = None,
    pdf_dir: Path = BULLETINS_DIR,
) -> dict[str, int]:
    LOGGER.info("Starting fetch stage (parish_name=%s)", parish_name or "*all*")
    metadata = load_json_list(BULLETINS_METADATA_PATH)
    existing_urls = {e["source_url"] for e in metadata}

    conn = connect_db()
    try:
        parishes = _parishes_for_run(conn, parish_name)
    finally:
        conn.close()

    fetched = 0
    skipped_existing = 0

    pw, browser, page = _launch_browser()
    try:
        for parish in parishes:
            slug = parish["slug"]
            source_type = parish["source_type"]
            source_provider_id = parish["source_provider_id"]

            if not source_type or not source_provider_id:
                continue

            try:
                link = _build_bulletin_link(source_type, source_provider_id, page=page)
            except ValueError:
                LOGGER.warning("Skipping parish %s: no supported source", slug)
                continue

            if link.source_url in existing_urls:
                skipped_existing += 1
                continue

            try:
                pdf_bytes = _download_pdf(fetch_url=link.fetch_url, source_url=link.source_url)
            except Exception:
                LOGGER.warning("Failed downloading bulletin for %s", slug, exc_info=True)
                continue

            content_hash = hashlib.sha256(pdf_bytes).hexdigest()
            parish_dir = pdf_dir / slug
            parish_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = parish_dir / f"{content_hash}.pdf"
            if not pdf_path.exists():
                pdf_path.write_bytes(pdf_bytes)

            metadata.append({
                "parish_slug": slug,
                "source_url": link.source_url,
                "pdf_path": str(pdf_path),
                "content_hash": content_hash,
                "fetched_at": utc_now_iso(),
                "processed_at": None,
                "published_date": None,
            })
            existing_urls.add(link.source_url)
            fetched += 1
            save_json_list(BULLETINS_METADATA_PATH, metadata)
    finally:
        browser.close()
        pw.stop()

    result = {"fetched_bulletins": fetched, "skipped_existing_urls": skipped_existing}
    LOGGER.info("Fetch stage finished: %s", result)
    return result


# ── Helpers ─────────────────────────────────────────────────────────────────

def _parishes_for_run(conn, parish_name: str | None) -> list:
    if parish_name:
        row = get_parish_by_name(conn, parish_name)
        if row is None:
            raise ValueError(f"Parish not found: {parish_name}")
        return [row]
    return list(list_parishes(conn))
