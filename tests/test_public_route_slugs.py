import csv
import gzip
import sqlite3
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

STABLE_CHURCH_ROUTE_SLUGS = {
    "our-lady-of-lake",
    "saint-anne",
    "saint-anthonys",
    "saint-elizabeth-ann-seton",
    "saint-januarius",
    "saint-jeromes",
    "saint-michael",
    "saint-michaels",
    "saint-patricks",
    "st-leo-great",
    "st-paul-of-cross",
}


def test_known_public_church_route_slugs_are_preserved_in_sources() -> None:
    """Church slugs back public /churches/:slug URLs and should not churn in data refreshes."""
    with (ROOT / "data" / "churches.csv").open(newline="", encoding="utf-8") as f:
        church_slugs = {row["slug"] for row in csv.DictReader(f)}

    assert STABLE_CHURCH_ROUTE_SLUGS <= church_slugs


def test_known_public_church_route_slugs_are_preserved_in_snapshot() -> None:
    snapshot = ROOT / "apps" / "web" / "public" / "frontend.snapshot"
    with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
        tmp.write(gzip.decompress(snapshot.read_bytes()))
        tmp.flush()
        placeholders = ",".join("?" for _ in STABLE_CHURCH_ROUTE_SLUGS)

        conn = sqlite3.connect(tmp.name)
        try:
            slugs = {
                row[0]
                for row in conn.execute(
                    f"SELECT slug FROM church WHERE slug IN ({placeholders})",
                    sorted(STABLE_CHURCH_ROUTE_SLUGS),
                )
            }
        finally:
            conn.close()

    assert STABLE_CHURCH_ROUTE_SLUGS <= slugs
