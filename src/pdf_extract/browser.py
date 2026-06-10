"""Shared Playwright browser launcher and page/anchor Protocol types."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Protocol

from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class AnchorLike(Protocol):
    def get_attribute(self, name: str) -> str | None: ...
    def inner_text(self) -> str: ...
    def text_content(self) -> str | None: ...


class PageLike(Protocol):
    def goto(self, url: str, wait_until: str = ..., timeout: float = ...) -> None: ...
    def wait_for_selector(
        self, selector: str, timeout: int, state: str | None = None,
    ) -> None: ...
    def query_selector_all(self, selector: str) -> list[AnchorLike]: ...
    def content(self) -> str: ...
    def wait_for_timeout(self, timeout: int) -> None: ...

    @property
    def url(self) -> str: ...


@contextmanager
def launch_stealth_browser(*, channel: str | None = None) -> Iterator[PageLike]:
    """Yield a stealth-patched page. PLAYWRIGHT_HEADLESS and
    PLAYWRIGHT_BROWSER_CHANNEL override the defaults; `channel` is the
    caller's default when the env var is unset (e.g. "chrome" for sites
    whose bot checks reject bundled Chromium)."""
    launch_kwargs: dict[str, object] = {
        "headless": _env_bool("PLAYWRIGHT_HEADLESS", False),
    }
    channel = os.getenv("PLAYWRIGHT_BROWSER_CHANNEL") or channel
    if channel:
        launch_kwargs["channel"] = channel

    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch_kwargs)
        try:
            context = browser.new_context()
            Stealth().apply_stealth_sync(context)
            yield context.new_page()
        finally:
            browser.close()
