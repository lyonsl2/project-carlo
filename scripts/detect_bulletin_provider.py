from __future__ import annotations

import argparse
import importlib
import json
import logging
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DB_PATH = Path("data/parish_events.db")
LOGGER = logging.getLogger(__name__)

PROVIDER_KEYWORDS: list[tuple[str, str]] = [
    ("files.ecatholic.com", "ecatholic"),
    ("parishesonline", "parishes_online"),
    ("discovermass", "discover_mass"),
]


CF_CHALLENGE_TIMEOUT_MS = 15_000


def _wait_for_cloudflare(page) -> None:  # type: ignore[no-untyped-def]
    """If the page is a Cloudflare challenge, wait for it to resolve."""
    if "just a moment" in (page.title() or "").lower():
        LOGGER.info("Cloudflare challenge detected, waiting up to %ds", CF_CHALLENGE_TIMEOUT_MS // 1000)
        try:
            page.wait_for_function(
                "document.title !== 'Just a moment...'",
                timeout=CF_CHALLENGE_TIMEOUT_MS,
            )
            page.wait_for_load_state("networkidle")
        except Exception:
            LOGGER.warning("Cloudflare challenge did not resolve in time")


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


def run_detection(
    *,
    db_path: Path,
    dry_run: bool,
    limit: int | None,
    pause_seconds: float,
) -> dict[str, int]:
    playwright_module = importlib.import_module("playwright.sync_api")
    sync_playwright = getattr(playwright_module, "sync_playwright")
    stealth_cls = getattr(importlib.import_module("playwright_stealth"), "Stealth")
    stealth = stealth_cls()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, homepage_url
            FROM website
            WHERE processed_at IS NULL
            ORDER BY id
            """
        ).fetchall()
        if limit is not None:
            rows = rows[:limit]

        updated = 0
        failed = 0

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False, channel="chrome")
            try:
                context = browser.new_context()
                stealth.apply_stealth_sync(context)
                page = context.new_page()
                for row in rows:
                    website_id = int(row["id"])
                    url = str(row["homepage_url"])
                    try:
                        LOGGER.info("Loading %s", url)
                        page.goto(url, wait_until="networkidle", timeout=30000)
                        _wait_for_cloudflare(page)
                        all_html_parts = [page.content()]
                        for frame in page.frames:
                            try:
                                all_html_parts.append(frame.content())
                            except Exception:
                                pass
                        html = "\n".join(all_html_parts)
                        provider, provider_id = detect_provider(html)
                        LOGGER.info("Detected provider=%s provider_id=%s for %s", provider, provider_id, url)
                    except Exception:
                        LOGGER.exception("Failed to load %s", url)
                        failed += 1
                        continue

                    if not dry_run:
                        now = datetime.now(timezone.utc).isoformat()
                        conn.execute(
                            """
                            UPDATE website
                            SET bulletin_provider = ?, provider_id = ?, processed_at = ?
                            WHERE id = ?
                            """,
                            (provider, provider_id, now, website_id),
                        )
                        conn.commit()
                    updated += 1

                    if pause_seconds > 0:
                        time.sleep(pause_seconds)
            finally:
                browser.close()

        return {"checked": len(rows), "updated": updated, "failed": failed}
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detect bulletin provider for unprocessed websites.",
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--pause-seconds", type=float, default=0.5)
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    result = run_detection(
        db_path=args.db_path,
        dry_run=args.dry_run,
        limit=args.limit,
        pause_seconds=args.pause_seconds,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
