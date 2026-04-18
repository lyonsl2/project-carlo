"""Verify church data against latest bulletin PDFs using Gemini AI."""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from pdf_extract.address import format_address
from pdf_extract.pdf_truncate import ensure_truncated_pdf
from pdf_extract.schedule_extraction import extract_verification
from pdf_extract.storage import (
    VERIFY_RESULTS_PATH,
    connect_db,
    get_parish_by_name,
    list_churches,
    load_json_dict,
    save_json_dict,
    utc_now_iso,
)

LOGGER = logging.getLogger(__name__)


def _find_verified_parishes(conn: sqlite3.Connection) -> set[str]:
    """Return parish slugs whose churches are all marked verified in the DB.

    A parish is considered fully verified only when it has at least one church
    and every church has both name_verified=1 and address_verified=1.
    """
    rows = conn.execute(
        """SELECT p.slug AS slug,
                  COUNT(c.id) AS total,
                  SUM(CASE WHEN c.name_verified = 1 AND c.address_verified = 1
                           THEN 1 ELSE 0 END) AS verified
           FROM parish p
           LEFT JOIN church c ON c.parish_id = p.id
           GROUP BY p.id"""
    ).fetchall()
    return {
        r["slug"]
        for r in rows
        if (r["total"] or 0) > 0 and (r["total"] or 0) == (r["verified"] or 0)
    }


def verify_churches(
    *,
    parish_name: str | None = None,
    model: str = "gemini-3-flash-preview",
) -> dict[str, int]:
    LOGGER.info("Starting verify stage (parish_name=%s, model=%s)", parish_name or "*all*", model)
    verify_results = load_json_dict(VERIFY_RESULTS_PATH)

    conn = connect_db()
    try:
        already_verified = _find_verified_parishes(conn)

        if parish_name:
            parish_row = get_parish_by_name(conn, parish_name)
            if not parish_row:
                LOGGER.warning("Parish not found: %s", parish_name)
                return {"verified_parishes": 0}
            parishes = [parish_row]
        else:
            parishes = conn.execute(
                "SELECT id, slug, name FROM parish ORDER BY id"
            ).fetchall()

        verified_count = 0
        for parish in parishes:
            parish_id = parish["id"]
            parish_slug = parish["slug"]

            if parish_slug in already_verified and not parish_name:
                LOGGER.info("Skipping already-verified parish %s", parish_slug)
                continue

            # Get latest bulletin PDF for this parish
            bulletin_row = conn.execute(
                """SELECT pdf_path FROM bulletin
                   WHERE parish_id = ? AND pdf_path IS NOT NULL
                   ORDER BY fetched_at DESC LIMIT 1""",
                (parish_id,),
            ).fetchone()

            if not bulletin_row or not bulletin_row["pdf_path"]:
                LOGGER.info("No bulletin PDF found for parish %s, skipping", parish_slug)
                continue

            pdf_path = Path(bulletin_row["pdf_path"])
            if not pdf_path.exists():
                LOGGER.warning("Bulletin PDF missing at %s, skipping", pdf_path)
                continue

            try:
                read_path = ensure_truncated_pdf(pdf_path)
            except Exception:
                LOGGER.warning("Failed truncating PDF at %s, skipping", pdf_path, exc_info=True)
                continue

            try:
                pdf_bytes = read_path.read_bytes()
            except OSError:
                LOGGER.warning("Failed reading PDF at %s", read_path, exc_info=True)
                continue

            # Get existing churches
            church_rows = list_churches(conn, parish_id)
            church_list = [
                {
                    "slug": r["slug"],
                    "name": r["name"],
                    "address": format_address(
                        r["address_line1"], r["address_line2"],
                        r["city"], r["state"], r["postal_code"],
                    ),
                }
                for r in church_rows
            ]

            if not church_list:
                LOGGER.info("No churches for parish %s, skipping", parish_slug)
                continue

            try:
                result = extract_verification(pdf_bytes, churches=church_list, model=model)
            except Exception:
                LOGGER.warning(
                    "Verification extraction failed for parish %s, skipping",
                    parish_slug,
                    exc_info=True,
                )
                continue

            # Save to verify_results.json
            verify_results[parish_slug] = {
                "verified_at": utc_now_iso(),
                "existing_churches": result["existing_churches"],
                "new_churches": result["new_churches"],
            }
            save_json_dict(VERIFY_RESULTS_PATH, verify_results)

            verified_count += 1
            LOGGER.info(
                "Verified parish %s: %d existing, %d new",
                parish_slug,
                len(result["existing_churches"]),
                len(result["new_churches"]),
            )
    finally:
        conn.close()

    result_stats = {"verified_parishes": verified_count}
    LOGGER.info("Verify stage finished: %s", result_stats)
    return result_stats
