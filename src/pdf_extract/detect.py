"""Detect bulletin provider for parish websites using Playwright."""

from __future__ import annotations

import importlib
import logging
import re
import time
from pathlib import Path

from pdf_extract.storage import (
    DETECT_RESULTS_PATH,
    connect_db,
    load_json_dict,
    save_json_dict,
)

LOGGER = logging.getLogger(__name__)

PROVIDER_KEYWORDS: list[tuple[str, str]] = [
    ("files.ecatholic.com", "ecatholic"),
    ("parishesonline", "parishes_online"),
    ("discovermass", "discover_mass"),
]


CF_CHALLENGE_TIMEOUT_MS = 15_000
_PARISHES_ONLINE_WIDGET_FRAME_TIMEOUT_MS = 15_000
_PARISHES_ONLINE_WIDGET_SELECTOR_TIMEOUT_MS = 15_000


def _wait_for_cloudflare(page) -> None:  # type: ignore[no-untyped-def]
    if "just a moment" in (page.title() or "").lower():
        LOGGER.info("Cloudflare challenge detected, waiting up to %ds", CF_CHALLENGE_TIMEOUT_MS // 1000)
        try:
            page.wait_for_function(
                "document.title !== 'Just a moment...'",
                timeout=CF_CHALLENGE_TIMEOUT_MS,
            )
            page.wait_for_load_state("domcontentloaded")
        except Exception:
            LOGGER.warning("Cloudflare challenge did not resolve in time")


def _wait_for_parishes_online_widget(page) -> None:  # type: ignore[no-untyped-def]
    for _ in range(_PARISHES_ONLINE_WIDGET_FRAME_TIMEOUT_MS // 500):
        parishes_frame = next(
            (f for f in page.frames if "parishesonline" in (f.url or "").lower()),
            None,
        )
        if parishes_frame is None:
            page.wait_for_timeout(500)
            continue
        try:
            parishes_frame.wait_for_selector(
                'a[href*="publication-page"]',
                timeout=_PARISHES_ONLINE_WIDGET_SELECTOR_TIMEOUT_MS,
            )
        except Exception:
            pass
        return
    return


_PARISHES_ONLINE_ID_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"parishesonline\.com/(?:organization|find)/([a-z0-9-]+)", re.IGNORECASE),
    re.compile(r"/publication-page/([a-z0-9-]+)", re.IGNORECASE),
]


def _extract_parishes_online_id(page_html: str) -> str | None:
    for pattern in _PARISHES_ONLINE_ID_PATTERNS:
        m = pattern.search(page_html)
        if m:
            return m.group(1)
    return None


def detect_provider(page_html: str) -> tuple[str, str | None]:
    """Return (provider, provider_id)."""
    html_lower = page_html.lower()
    for keyword, provider in PROVIDER_KEYWORDS:
        if keyword in html_lower:
            provider_id = None
            if provider == "parishes_online":
                provider_id = _extract_parishes_online_id(page_html)
            return provider, provider_id
    return "other", None


_FRAME_CONTENT_TIMEOUT_MS = 5_000


def _collect_page_html(page, *, include_frames: bool = True) -> str:  # type: ignore[no-untyped-def]
    parts = [page.content()]
    if not include_frames:
        return "\n".join(parts)
    try:
        page.set_default_timeout(_FRAME_CONTENT_TIMEOUT_MS)
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            if frame.is_detached():
                continue
            try:
                frame.wait_for_load_state("domcontentloaded", timeout=_FRAME_CONTENT_TIMEOUT_MS)
                parts.append(frame.content())
            except Exception:
                LOGGER.debug("Skipping frame %s (timeout or error)", frame.url)
    finally:
        page.set_default_timeout(30_000)
    return "\n".join(parts)


_BULLETIN_LINK_RE = re.compile(r"bulletin", re.IGNORECASE)


def _find_bulletin_hrefs(page) -> list[str]:  # type: ignore[no-untyped-def]
    anchors = page.query_selector_all("a[href]")
    seen: set[str] = set()
    result: list[str] = []
    base_url = page.url
    for anchor in anchors:
        href = anchor.get_attribute("href")
        if not href or not _BULLETIN_LINK_RE.search(href):
            continue
        if href.startswith("/"):
            from urllib.parse import urljoin
            href = urljoin(base_url, href)
        if not href.startswith("http"):
            continue
        if href not in seen:
            seen.add(href)
            result.append(href)
    return result


def _detect_from_bulletin_links(page) -> tuple[str, str | None]:  # type: ignore[no-untyped-def]
    hrefs = _find_bulletin_hrefs(page)
    LOGGER.info("Found %d bulletin link(s) to check", len(hrefs))
    for href in hrefs:
        try:
            LOGGER.info("  Following bulletin link: %s", href)
            page.goto(href, wait_until="domcontentloaded", timeout=30000)
            _wait_for_cloudflare(page)
            _wait_for_parishes_online_widget(page)
            html = _collect_page_html(page, include_frames=True)
            provider, provider_id = detect_provider(html)
            if provider != "other":
                return provider, provider_id
        except (TimeoutError, OSError) as exc:
            LOGGER.warning("  Failed to load bulletin link %s: %s", href, exc)
    return "other", None


def run_detection(
    *,
    db_path: Path,
    dry_run: bool,
    limit: int | None,
    pause_seconds: float,
) -> dict[str, int]:
    # Load existing results to skip already-processed slugs
    results = load_json_dict(DETECT_RESULTS_PATH)

    conn = connect_db(db_path)
    try:
        rows = conn.execute("SELECT slug, homepage_url FROM website ORDER BY id").fetchall()
    finally:
        conn.close()

    # Only process websites not already in results
    pending = [r for r in rows if r["slug"] not in results]
    if limit is not None:
        pending = pending[:limit]

    playwright_module = importlib.import_module("playwright.sync_api")
    sync_playwright = getattr(playwright_module, "sync_playwright")
    stealth_cls = getattr(importlib.import_module("playwright_stealth"), "Stealth")
    stealth = stealth_cls()

    updated = 0
    failed = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chrome")
        try:
            context = browser.new_context()
            stealth.apply_stealth_sync(context)
            page = context.new_page()
            for row in pending:
                slug = row["slug"]
                url = str(row["homepage_url"])
                try:
                    LOGGER.info("Loading %s", url)
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    _wait_for_cloudflare(page)
                    _wait_for_parishes_online_widget(page)
                    html = _collect_page_html(page)
                    provider, provider_id = detect_provider(html)
                    if provider == "other":
                        LOGGER.info("No provider on homepage, checking bulletin links for %s", url)
                        provider, provider_id = _detect_from_bulletin_links(page)
                    LOGGER.info("Detected provider=%s provider_id=%s for %s", provider, provider_id, url)
                except (TimeoutError, OSError) as exc:
                    LOGGER.warning("Failed to load %s: %s", url, exc)
                    failed += 1
                    continue

                if not dry_run:
                    results[slug] = {
                        "bulletin_provider": provider,
                        "provider_id": provider_id,
                        "bulletin_page": None,
                    }
                updated += 1

                if pause_seconds > 0:
                    time.sleep(pause_seconds)
        finally:
            browser.close()

    if not dry_run:
        save_json_dict(DETECT_RESULTS_PATH, results)

    return {"checked": len(pending), "updated": updated, "failed": failed}
