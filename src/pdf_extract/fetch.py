"""Bulletin fetch pipeline: resolve provider links, download PDFs, save metadata."""

from __future__ import annotations

import hashlib
import importlib
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from playwright.sync_api import Browser, Page, Playwright

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
OTHER_TYPE = "other"
PARISHES_ONLINE_ORG_URL_TEMPLATE = "https://parishesonline.com/organization/{provider_id}"
PARISHES_ONLINE_PUBLICATION_URL_PREFIX = (
    "https://parishesonline.com/publication-page/{provider_id}?selectedPublication="
)
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class BulletinLink:
    source_url: str
    fetch_url: str


@dataclass(frozen=True)
class _OtherPdfCandidate:
    source_url: str
    fetch_url: str
    parsed_date: date | None


def _first_sunday_on_or_after(d: date) -> date:
    return d + timedelta(days=(6 - d.weekday()) % 7)


def _next_sunday_after(d: date) -> date:
    return _first_sunday_on_or_after(d + timedelta(days=1))


# ── eCatholic bulletin resolution ───────────────────────────────────────────

def build_latest_ecatholic_bulletin_links(
    *, provider_id: str, reference_date: date | None = None, page: Page | None = None,
) -> BulletinLink:
    _ = reference_date
    source_url, fetch_url = _resolve_ecatholic_latest_link(provider_id=provider_id, page=page)
    return BulletinLink(source_url=source_url, fetch_url=fetch_url)


def _resolve_ecatholic_latest_link(
    *, provider_id: str, page: Page | None = None,
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
    *, provider_id: str, page: Page | None = None,
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


def _launch_browser() -> tuple[Playwright, Browser, Page]:
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
    page: Page | None = None,
) -> tuple[str, str]:
    owns_browser = page is None
    pw = None
    browser = None
    if owns_browser:
        pw, browser, page = _launch_browser()

    try:
        LOGGER.info("Resolving latest anchor link (%s)", source_label)
        LOGGER.info("Visiting page URL: %s", page_url)
        _goto_with_retry(page=page, page_url=page_url)  # type: ignore[arg-type]
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
    *, provider_id: str, reference_date: date | None = None, page: Page | None = None,
) -> BulletinLink:
    source_url, fetch_url = _resolve_parishes_online_latest_link(provider_id=provider_id, page=page)
    _ = reference_date
    return BulletinLink(source_url=source_url, fetch_url=fetch_url)


def build_latest_other_bulletin_links(
    *, provider_id: str, reference_date: date | None = None, page: Page | None = None,
) -> BulletinLink:
    source_url, fetch_url = _resolve_other_latest_link(
        provider_id=provider_id, reference_date=reference_date, page=page,
    )
    return BulletinLink(source_url=source_url, fetch_url=fetch_url)


def _resolve_other_latest_link(
    *, provider_id: str, reference_date: date | None = None, page: Page | None = None,
) -> tuple[str, str]:
    owns_browser = page is None
    pw = None
    browser = None
    if owns_browser:
        pw, browser, page = _launch_browser()

    try:
        today = reference_date or date.today()
        _goto_with_retry(page=page, page_url=provider_id)  # type: ignore[arg-type]
        page.wait_for_selector("a[href]", timeout=15000)  # type: ignore[union-attr]
        bulletin_page_url = _find_other_bulletin_page_url(page=page, base_url=provider_id)
        if bulletin_page_url is None:
            raise ValueError(f"No bulletin page link found for other provider at {provider_id}")

        _goto_with_retry(page=page, page_url=bulletin_page_url)  # type: ignore[arg-type]
        page.wait_for_selector("a[href]", timeout=15000)  # type: ignore[union-attr]
        current_page_url = getattr(page, "url", bulletin_page_url)
        candidates = _collect_other_pdf_candidates(
            page=page, base_url=current_page_url, reference_date=today,
        )
        if not candidates:
            raise ValueError(f"No PDF links found on bulletin page: {bulletin_page_url}")

        dated_candidates = [
            c for c in candidates
            if c.parsed_date is not None and abs((c.parsed_date - today).days) <= 7
        ]
        if dated_candidates:
            best = max(dated_candidates, key=lambda c: c.parsed_date or date.min)
            return best.source_url, best.fetch_url

        first = candidates[0]
        return first.source_url, first.fetch_url
    finally:
        if owns_browser:
            if browser is not None:
                browser.close()
            if pw is not None:
                pw.stop()


def _find_other_bulletin_page_url(*, page: Page, base_url: str) -> str | None:
    anchors = page.query_selector_all("a[href]")
    both_matches: list[str] = []
    either_matches: list[str] = []
    for anchor in anchors:
        href = anchor.get_attribute("href")
        if not isinstance(href, str):
            continue
        text = _anchor_text(anchor)
        href_lower = href.lower()
        text_lower = text.lower()
        has_in_href = "bulletin" in href_lower
        has_in_text = "bulletin" in text_lower
        if not has_in_href and not has_in_text:
            continue
        resolved = urljoin(base_url, href)
        if has_in_href and has_in_text:
            both_matches.append(resolved)
        else:
            either_matches.append(resolved)

    if both_matches:
        return both_matches[0]
    if either_matches:
        return either_matches[0]
    return None


def _collect_other_pdf_candidates(
    *, page: Page, base_url: str, reference_date: date,
) -> list[_OtherPdfCandidate]:
    anchors = page.query_selector_all("a[href]")
    candidates: list[_OtherPdfCandidate] = []
    for anchor in anchors:
        href = anchor.get_attribute("href")
        if not isinstance(href, str):
            continue
        absolute_href = urljoin(base_url, href)
        href_lower = absolute_href.lower()
        if ".pdf" not in href_lower:
            continue
        text = _anchor_text(anchor)
        parsed_date = _parse_relaxed_date_from_texts([text, href, absolute_href], reference_date)
        candidates.append(
            _OtherPdfCandidate(
                source_url=absolute_href,
                fetch_url=absolute_href,
                parsed_date=parsed_date,
            )
        )
    return candidates


def _anchor_text(anchor) -> str:
    inner_text_method = getattr(anchor, "inner_text", None)
    if callable(inner_text_method):
        try:
            text = inner_text_method()
            if isinstance(text, str):
                return text.strip()
        except Exception:
            pass

    text_content_method = getattr(anchor, "text_content", None)
    if callable(text_content_method):
        try:
            text = text_content_method()
            if isinstance(text, str):
                return text.strip()
        except Exception:
            pass
    return ""


def _parse_relaxed_date_from_texts(texts: list[str], reference_date: date) -> date | None:
    for text in texts:
        parsed = _parse_relaxed_date(text, reference_date)
        if parsed is not None:
            return parsed
    return None


def _parse_relaxed_date(text: str, reference_date: date) -> date | None:
    if not text:
        return None

    normalized = text.lower()
    normalized = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", normalized)
    normalized = normalized.replace(",", " ")
    normalized = re.sub(r"\s+", " ", normalized).strip()

    month_name = (
        r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
        r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|"
        r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
    )
    month_day_pattern = re.compile(
        rf"(?P<month>{month_name})\s+(?P<day>\d{{1,2}})(?:\s+(?P<year>\d{{2,4}}))?",
        flags=re.IGNORECASE,
    )
    day_month_pattern = re.compile(
        rf"(?P<day>\d{{1,2}})\s+(?P<month>{month_name})(?:\s+(?P<year>\d{{2,4}}))?",
        flags=re.IGNORECASE,
    )

    for pattern in (month_day_pattern, day_month_pattern):
        for match in pattern.finditer(normalized):
            month_num = _month_name_to_number(match.group("month"))
            if month_num is None:
                continue
            day = int(match.group("day"))
            raw_year = match.group("year")
            if raw_year:
                parsed = _safe_date(_normalize_year(raw_year, reference_date), month_num, day)
            else:
                parsed = _resolve_yearless_date(
                    month=month_num, day=day, reference_date=reference_date,
                )
            if parsed is not None:
                return parsed

    for match in re.finditer(r"(?P<year>\d{4})[-/.](?P<month>\d{1,2})[-/.](?P<day>\d{1,2})", normalized):
        parsed = _safe_date(int(match.group("year")), int(match.group("month")), int(match.group("day")))
        if parsed is not None:
            return parsed

    for match in re.finditer(r"(?P<a>\d{1,2})[-/.](?P<b>\d{1,2})[-/.](?P<c>\d{2,4})", normalized):
        month = int(match.group("a"))
        day = int(match.group("b"))
        year = _normalize_year(match.group("c"), reference_date)
        parsed = _safe_date(year, month, day)
        if parsed is not None:
            return parsed

    for match in re.finditer(r"(?P<a>\d{1,2})[-/.](?P<b>\d{1,2})", normalized):
        month = int(match.group("a"))
        day = int(match.group("b"))
        parsed = _resolve_yearless_date(month=month, day=day, reference_date=reference_date)
        if parsed is not None:
            return parsed
    return None


def _month_name_to_number(month_name: str) -> int | None:
    month_lookup = {
        "jan": 1, "january": 1,
        "feb": 2, "february": 2,
        "mar": 3, "march": 3,
        "apr": 4, "april": 4,
        "may": 5,
        "jun": 6, "june": 6,
        "jul": 7, "july": 7,
        "aug": 8, "august": 8,
        "sep": 9, "sept": 9, "september": 9,
        "oct": 10, "october": 10,
        "nov": 11, "november": 11,
        "dec": 12, "december": 12,
    }
    return month_lookup.get(month_name.lower())


def _normalize_year(raw_year: str | None, reference_date: date) -> int:
    if not raw_year:
        return reference_date.year
    year = int(raw_year)
    if len(raw_year) == 2:
        year = 2000 + year
    return year


def _resolve_yearless_date(*, month: int, day: int, reference_date: date) -> date | None:
    candidates = [
        _safe_date(reference_date.year - 1, month, day),
        _safe_date(reference_date.year, month, day),
        _safe_date(reference_date.year + 1, month, day),
    ]
    valid = [d for d in candidates if d is not None]
    if not valid:
        return None
    return min(valid, key=lambda d: abs((d - reference_date).days))


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return datetime(year, month, day).date()
    except ValueError:
        return None


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
    source_type: str, source_provider_id: str, *, page: Page | None = None,
) -> BulletinLink:
    if source_type == "ecatholic":
        return build_latest_ecatholic_bulletin_links(provider_id=source_provider_id, page=page)
    if source_type == PARISHES_ONLINE_TYPE:
        return build_latest_parishes_online_bulletin_links(provider_id=source_provider_id, page=page)
    if source_type == OTHER_TYPE:
        return build_latest_other_bulletin_links(provider_id=source_provider_id, page=page)
    raise ValueError(f"Unsupported source_type: {source_type}")


# ── HTTP helpers ────────────────────────────────────────────────────────────

def _http_get_bytes(url: str, *, referer: str | None = None, timeout: int = 60) -> bytes:
    request_url = _normalize_url_for_request(url)
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
    req = Request(request_url, headers=headers)
    LOGGER.info("Fetching URL: %s", request_url)
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _normalize_url_for_request(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return url
    path = quote(parsed.path, safe="/%:@+~!$&'()*;,=-._")
    params = quote(parsed.params, safe="%:@+~!$&'()*;,=-._")
    query = quote(parsed.query, safe="=&%:@+~!$'()*;,/-._")
    fragment = quote(parsed.fragment, safe="%:@+~!$&'()*;,=/-._")
    return urlunparse((parsed.scheme, parsed.netloc, path, params, query, fragment))


def _goto_with_retry(*, page: Page, page_url: str, max_attempts: int = 3) -> None:
    for attempt in range(1, max_attempts + 1):
        try:
            page.goto(page_url, wait_until="domcontentloaded")
            return
        except Exception as exc:
            error_text = str(exc).lower()
            interrupted = "interrupted by another navigation" in error_text
            is_last_attempt = attempt == max_attempts
            if not interrupted or is_last_attempt:
                raise
            LOGGER.warning(
                "Navigation interrupted for %s (attempt %d/%d), retrying",
                page_url, attempt, max_attempts,
            )
            page.wait_for_timeout(250)


def _download_pdf(*, fetch_url: str, source_url: str) -> bytes:
    referer = source_url
    try:
        LOGGER.info("Attempting primary fetch URL: %s", fetch_url)
        return _http_get_bytes(fetch_url, referer=referer, timeout=60)
    except (HTTPError, URLError, OSError) as exc:
        LOGGER.warning("Primary fetch failed (%s), falling back to source URL: %s", exc, source_url)
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
            except Exception as exc:
                LOGGER.warning("Failed resolving bulletin link for parish %s: %s", slug, exc, exc_info=True)
                continue

            if link.source_url in existing_urls:
                skipped_existing += 1
                continue

            try:
                pdf_bytes = _download_pdf(fetch_url=link.fetch_url, source_url=link.source_url)
            except (HTTPError, URLError, OSError) as exc:
                LOGGER.warning("Failed downloading bulletin for %s: %s", slug, exc)
                continue

            try:
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
            except Exception as exc:
                LOGGER.warning("Failed saving bulletin for parish %s: %s", slug, exc, exc_info=True)
                continue
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
