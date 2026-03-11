"""Bulletin sync pipeline: fetch, process with AI, and persist."""

from __future__ import annotations

import hashlib
import importlib
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from pdf_extract.schedule_extraction import extract_events
from pdf_extract.storage import (
    connect_db,
    get_parish_id,
    insert_bulletin,
    insert_bulletin_event,
    insert_church,
    insert_event,
    list_churches,
    list_bulletins_pending_processing,
    list_existing_bulletin_urls,
    list_parish_ids,
    get_parish_source,
    mark_bulletin_processed,
    migrate_db,
    update_church_address_if_missing,
)

ECATHOLIC_BULLETINS_PATH = "/bulletins"
PARISHES_ONLINE_TYPE = "parishes-online"
PARISHES_ONLINE_ORG_URL_TEMPLATE = "https://parishesonline.com/organization/{provider_id}"
PARISHES_ONLINE_PUBLICATION_URL_PREFIX = (
    "https://parishesonline.com/publication-page/{provider_id}?selectedPublication="
)
LOGGER = logging.getLogger(__name__)
DEFAULT_PDF_DIR = Path("data/bulletins")


@dataclass(frozen=True)
class BulletinLink:
    source_url: str
    fetch_url: str


def normalize_church_name(name: str | None) -> str:
    if not name:
        return ""
    normalized = name.lower()
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(r"\bst\b", "saint", normalized)
    normalized = re.sub(r"\bchurch\s*$", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _normalize_address(address: str | None) -> str:
    if not address:
        return ""
    normalized = address.lower()
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _first_sunday_on_or_after(d: date) -> date:
    # Monday=0 .. Sunday=6
    return d + timedelta(days=(6 - d.weekday()) % 7)


def _next_sunday_after(d: date) -> date:
    # Return the next Sunday strictly after the given date.
    return _first_sunday_on_or_after(d + timedelta(days=1))


def build_latest_ecatholic_bulletin_links(
    *, provider_id: str, reference_date: date | None = None
) -> BulletinLink:
    _ = reference_date  # unused; kept for call-site compatibility
    source_url, fetch_url = _resolve_ecatholic_latest_link(provider_id=provider_id)
    return BulletinLink(source_url=source_url, fetch_url=fetch_url)


def _resolve_ecatholic_latest_link(*, provider_id: str) -> tuple[str, str]:
    bulletins_url = urljoin(provider_id.rstrip("/") + "/", ECATHOLIC_BULLETINS_PATH.lstrip("/"))
    return _resolve_latest_anchor_link_from_html_fetch(
        page_url=bulletins_url,
        source_label=f"ecatholic provider_id={provider_id}",
        href_filter=lambda href: "files.ecatholic.com" in href and "bulletins" in href,
        href_to_urls=lambda href: _extract_ecatholic_pdf_url_from_href(
            href=href,
            base_url=bulletins_url,
        ),
    )


class _AnchorHrefParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        for key, value in attrs:
            if key.lower() == "href" and isinstance(value, str):
                self.hrefs.append(value)
                return


def _resolve_latest_anchor_link_from_html_fetch(
    *,
    page_url: str,
    source_label: str,
    href_filter: Callable[[str], bool],
    href_to_urls: Callable[[str], tuple[str, str] | None],
) -> tuple[str, str]:
    LOGGER.info("Resolving latest anchor link from HTML (%s)", source_label)
    html_bytes = _http_get_bytes(page_url, timeout=30)
    parser = _AnchorHrefParser()
    parser.feed(html_bytes.decode("utf-8", errors="replace"))
    for href in parser.hrefs:
        if not href_filter(href):
            continue
        urls = href_to_urls(href)
        if urls is None:
            continue
        LOGGER.info("Resolved latest anchor link from HTML (%s)", source_label)
        return urls
    raise ValueError(f"No matching anchor link found for {source_label} at {page_url}")


def _resolve_parishes_online_latest_link(*, provider_id: str) -> tuple[str, str]:
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
    )


def _resolve_latest_anchor_link_with_playwright(
    *,
    page_url: str,
    anchor_selector: str,
    source_label: str,
    href_to_urls: Callable[[str], tuple[str, str] | None],
) -> tuple[str, str]:
    playwright_module = importlib.import_module("playwright.sync_api")
    sync_playwright = getattr(playwright_module, "sync_playwright")

    LOGGER.info("Resolving latest anchor link (%s)", source_label)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            LOGGER.info("Visiting page URL: %s", page_url)
            page.goto(page_url, wait_until="domcontentloaded")
            page.wait_for_selector(anchor_selector, timeout=15000)
            anchors = page.query_selector_all(anchor_selector)
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
            browser.close()

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
    *, provider_id: str, reference_date: date | None = None
) -> BulletinLink:
    source_url, fetch_url = _resolve_parishes_online_latest_link(provider_id=provider_id)
    _ = reference_date  # unused; kept for call-site compatibility
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
    # Some pages double-encode this query parameter.
    for _ in range(2):
        selected = unquote(selected)
    if not selected.lower().startswith("https://container.parishesonline.com/"):
        return None
    if not selected.lower().endswith(".pdf"):
        return None
    return absolute_href, selected


def _build_latest_bulletin_links_for_parish(*, conn, parish_id: int) -> BulletinLink:
    row = get_parish_source(conn, parish_id)
    if row is None:
        raise ValueError(f"No parish found for parish_id={parish_id}")
    source_type = row["source_type"]
    provider_id = row["source_provider_id"]
    if not source_type or not provider_id:
        raise ValueError(f"No supported source configured for parish_id={parish_id}")
    LOGGER.info(
        "Selected source for parish_id=%s: type=%s provider_id=%s",
        parish_id,
        source_type,
        provider_id,
    )
    if source_type == "ecatholic":
        return build_latest_ecatholic_bulletin_links(provider_id=provider_id)
    if source_type == PARISHES_ONLINE_TYPE:
        return build_latest_parishes_online_bulletin_links(provider_id=provider_id)
    raise ValueError(f"No supported source configured for parish_id={parish_id}")


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
    # Kept dual URL arguments to preserve call-site flexibility.
    referer = source_url
    try:
        LOGGER.info("Attempting primary fetch URL: %s", fetch_url)
        return _http_get_bytes(fetch_url, referer=referer, timeout=60)
    except Exception:
        LOGGER.warning("Primary fetch failed, falling back to source URL: %s", source_url)
        return _http_get_bytes(source_url, referer=referer, timeout=60)


def _resolve_church_id(
    *,
    conn,
    parish_id: int,
    church_name: str | None,
    church_address: str | None,
    threshold: float = 0.90,
) -> int:
    desired_norm = normalize_church_name(church_name)
    desired_address_norm = _normalize_address(church_address)
    existing = list_churches(conn, parish_id)

    if desired_address_norm:
        for row in existing:
            row_address_norm = _normalize_address(row["address"] if isinstance(row["address"], str) else None)
            if row_address_norm and row_address_norm == desired_address_norm:
                matched_id = int(row["id"])
                update_church_address_if_missing(
                    conn, church_id=matched_id, new_address=church_address
                )
                return matched_id

    best_id: int | None = None
    best_score = 0.0
    for row in existing:
        row_norm = str(row["name_normalized"] or "")
        if desired_norm and row_norm and desired_norm == row_norm:
            best_id = int(row["id"])
            best_score = 1.0
            break
        score = SequenceMatcher(None, desired_norm, row_norm).ratio() if desired_norm and row_norm else 0.0
        if score > best_score:
            best_score = score
            best_id = int(row["id"])

    if best_id is not None and best_score >= threshold:
        update_church_address_if_missing(conn, church_id=best_id, new_address=church_address)
        return best_id

    return insert_church(
        conn,
        parish_id=parish_id,
        name=church_name,
        address=church_address,
        name_normalized=desired_norm or None,
    )


def _parish_ids_for_run(conn, parish_name: str | None) -> list[int]:
    if parish_name:
        return [get_parish_id(conn, parish_name)]
    return list_parish_ids(conn)


def fetch_bulletins(*, parish_name: str | None = None, pdf_dir: Path = DEFAULT_PDF_DIR) -> dict[str, int]:
    LOGGER.info("Starting fetch stage (parish_name=%s)", parish_name or "*all*")
    migrate_db()
    conn = connect_db()
    try:
        parish_ids = _parish_ids_for_run(conn, parish_name)
        fetched = 0
        skipped_existing = 0
        for parish_id in parish_ids:
            LOGGER.info("Fetching latest bulletin for parish_id=%s", parish_id)
            try:
                link = _build_latest_bulletin_links_for_parish(conn=conn, parish_id=parish_id)
            except ValueError:
                LOGGER.warning("Skipping parish_id=%s: no supported source configuration", parish_id)
                continue

            existing_urls = list_existing_bulletin_urls(conn, parish_id)
            if link.source_url in existing_urls:
                skipped_existing += 1
                LOGGER.debug(
                    "Skipping existing bulletin URL for parish_id=%s: %s",
                    parish_id,
                    link.source_url,
                )
                continue

            try:
                pdf_bytes = _download_pdf(fetch_url=link.fetch_url, source_url=link.source_url)
            except Exception:
                LOGGER.warning(
                    "Failed downloading bulletin for parish_id=%s (source_url=%s)",
                    parish_id,
                    link.source_url,
                    exc_info=True,
                )
                continue

            content_hash = hashlib.sha256(pdf_bytes).hexdigest()
            parish_dir = pdf_dir / str(parish_id)
            parish_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = parish_dir / f"{content_hash}.pdf"
            if not pdf_path.exists():
                pdf_path.write_bytes(pdf_bytes)

            insert_bulletin(
                conn,
                parish_id=parish_id,
                source_url=link.source_url,
                pdf_path=str(pdf_path),
                published_date=None,
                content_hash=content_hash,
            )
            conn.commit()
            fetched += 1

        result = {"fetched_bulletins": fetched, "skipped_existing_urls": skipped_existing}
        LOGGER.info("Fetch stage finished: %s", result)
        return result
    finally:
        conn.close()


def process_bulletins(
    *,
    parish_name: str | None = None,
    model: str = "gemini-3-flash-preview",
) -> dict[str, int]:
    LOGGER.info("Starting process stage (parish_name=%s, model=%s)", parish_name or "*all*", model)
    migrate_db()
    conn = connect_db()
    try:
        parish_ids = _parish_ids_for_run(conn, parish_name)
        processed_count = 0
        inserted_events = 0
        for parish_id in parish_ids:
            rows = list_bulletins_pending_processing(conn, parish_id=parish_id)
            for row in rows:
                bulletin_id = int(row["id"])
                pdf_path_raw = row["pdf_path"]
                if not isinstance(pdf_path_raw, str) or not pdf_path_raw:
                    continue
                pdf_path = Path(pdf_path_raw)
                if not pdf_path.exists():
                    LOGGER.warning(
                        "Skipping process for bulletin_id=%s: PDF file missing at %s",
                        bulletin_id,
                        pdf_path,
                    )
                    continue

                try:
                    pdf_bytes = pdf_path.read_bytes()
                except OSError:
                    LOGGER.warning(
                        "Skipping process for bulletin_id=%s: failed reading PDF at %s",
                        bulletin_id,
                        pdf_path,
                        exc_info=True,
                    )
                    continue

                extracted = extract_events(pdf_bytes, model=model)

                churches = extracted.get("churches", [])
                church_map: dict[str, int] = {}
                for ch in churches:
                    if not isinstance(ch, dict):
                        continue
                    extracted_id = ch.get("id")
                    if not isinstance(extracted_id, str) or not extracted_id:
                        continue
                    church_db_id = _resolve_church_id(
                        conn=conn,
                        parish_id=parish_id,
                        church_name=ch.get("name") if isinstance(ch.get("name"), str) else None,
                        church_address=ch.get("address") if isinstance(ch.get("address"), str) else None,
                    )
                    church_map[extracted_id] = church_db_id

                events = extracted.get("events", [])
                for ev in events:
                    if not isinstance(ev, dict):
                        continue
                    extracted_church_id = ev.get("church_id")
                    if not isinstance(extracted_church_id, str):
                        continue
                    church_id = church_map.get(extracted_church_id)
                    if church_id is None:
                        continue

                    event_id = insert_event(
                        conn,
                        church_id=church_id,
                        event_type=str(ev.get("type", "")),
                        event_kind=str(ev.get("kind", "")),
                        day_of_week=ev.get("day_of_week")
                        if isinstance(ev.get("day_of_week"), str)
                        else None,
                        date=ev.get("date") if isinstance(ev.get("date"), str) else None,
                        start_time=str(ev.get("start_time", "")),
                        end_time=ev.get("end_time") if isinstance(ev.get("end_time"), str) else None,
                        cancelled=bool(ev.get("cancelled", False)),
                        raw_json=json.dumps(ev, sort_keys=True),
                    )
                    insert_bulletin_event(conn, bulletin_id=bulletin_id, event_id=event_id)
                    inserted_events += 1

                mark_bulletin_processed(conn, bulletin_id=bulletin_id)
                conn.commit()
                processed_count += 1

        result = {"processed_bulletins": processed_count, "inserted_events": inserted_events}
        LOGGER.info("Process stage finished: %s", result)
        return result
    finally:
        conn.close()


def sync_bulletins(
    *,
    parish_name: str | None = None,
    model: str = "gemini-3-flash-preview",
) -> dict[str, int]:
    LOGGER.info("Starting full sync run (parish_name=%s, model=%s)", parish_name or "*all*", model)
    fetch_result = fetch_bulletins(parish_name=parish_name)
    process_result = process_bulletins(parish_name=parish_name, model=model)
    result = {
        "fetched_bulletins": fetch_result["fetched_bulletins"],
        "processed_bulletins": process_result["processed_bulletins"],
        "inserted_events": process_result["inserted_events"],
    }
    LOGGER.info("Full sync finished: %s", result)
    return result
