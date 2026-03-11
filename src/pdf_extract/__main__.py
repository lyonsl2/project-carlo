"""CLI entry point for pdf_extract."""

import argparse
import json
import logging
import sys

from pdf_extract.storage import DEFAULT_DB_PATH, delete_db, downgrade_db, migrate_db
from pdf_extract.sync import fetch_bulletins, process_bulletins, sync_bulletins

LOGGER = logging.getLogger(__name__)


def _configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity (default: INFO)",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pdf_extract",
        description="Fetch bulletin PDFs, process events, and manage parish data.",
    )
    subparsers = parser.add_subparsers(dest="command")

    # -- fetch --
    fetch_parser = subparsers.add_parser("fetch", help="Fetch latest PDFs and save to disk/db")
    fetch_parser.add_argument("--parish", help="Parish name (omit to run for all)")
    _add_common_args(fetch_parser)

    # -- process --
    process_parser = subparsers.add_parser("process", help="Process fetched PDFs with Gemini and save events")
    process_parser.add_argument("--parish", help="Parish name (omit to run for all)")
    process_parser.add_argument("--model", default="gemini-3-flash-preview", help="Gemini model (default: gemini-3-flash-preview)")
    _add_common_args(process_parser)

    # -- sync (fetch + process) --
    sync_parser = subparsers.add_parser("sync", help="Fetch and process in one step")
    sync_parser.add_argument("--parish", help="Parish name (omit to run for all)")
    sync_parser.add_argument("--model", default="gemini-3-flash-preview", help="Gemini model (default: gemini-3-flash-preview)")
    _add_common_args(sync_parser)

    # -- detect --
    detect_parser = subparsers.add_parser("detect", help="Detect bulletin provider for parish websites")
    detect_parser.add_argument("--db-path", type=str, default=str(DEFAULT_DB_PATH))
    detect_parser.add_argument("--dry-run", action="store_true")
    detect_parser.add_argument("--limit", type=int, default=None)
    detect_parser.add_argument("--pause-seconds", type=float, default=0.5)
    _add_common_args(detect_parser)

    # -- geocode --
    geocode_parser = subparsers.add_parser("geocode", help="Backfill church lat/lng from address")
    geocode_parser.add_argument("--db-path", type=str, default=str(DEFAULT_DB_PATH))
    geocode_parser.add_argument("--dry-run", action="store_true")
    geocode_parser.add_argument("--limit", type=int, default=None)
    geocode_parser.add_argument("--pause-seconds", type=float, default=1.0)
    geocode_parser.add_argument("--email", type=str, default=None, help="Email for Nominatim usage policy")
    _add_common_args(geocode_parser)

    # -- seed --
    seed_parser = subparsers.add_parser("seed", help="Seed parish table from website provider data")
    seed_parser.add_argument("--db-path", type=str, default=str(DEFAULT_DB_PATH))
    seed_parser.add_argument("--dry-run", action="store_true")
    _add_common_args(seed_parser)

    # -- db --
    db_parser = subparsers.add_parser("db", help="Database management commands")
    db_subparsers = db_parser.add_subparsers(dest="db_command")

    db_migrate_parser = db_subparsers.add_parser("migrate", help="Apply Alembic migrations")
    _add_common_args(db_migrate_parser)

    db_drop_parser = db_subparsers.add_parser("drop", help="Delete the SQLite DB file")
    _add_common_args(db_drop_parser)

    db_downgrade_parser = db_subparsers.add_parser("downgrade", help="Downgrade DB to a revision")
    db_downgrade_parser.add_argument("revision", nargs="?", default="-1", help="Target revision (default: -1, one step back)")
    _add_common_args(db_downgrade_parser)

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = _build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 1

    _configure_logging(args.log_level)

    try:
        if args.command == "fetch":
            result = fetch_bulletins(parish_name=args.parish)
        elif args.command == "process":
            result = process_bulletins(parish_name=args.parish, model=args.model)
        elif args.command == "sync":
            result = sync_bulletins(parish_name=args.parish, model=args.model)
        elif args.command == "detect":
            from pathlib import Path

            from pdf_extract.detect import run_detection

            result = run_detection(
                db_path=Path(args.db_path),
                dry_run=args.dry_run,
                limit=args.limit,
                pause_seconds=args.pause_seconds,
            )
        elif args.command == "geocode":
            from pathlib import Path

            from pdf_extract.geocode import run_backfill

            result = run_backfill(
                db_path=Path(args.db_path),
                dry_run=args.dry_run,
                limit=args.limit,
                pause_seconds=args.pause_seconds,
                email=args.email,
            )
        elif args.command == "seed":
            from pathlib import Path

            from pdf_extract.seed import seed_parishes

            result = seed_parishes(
                db_path=Path(args.db_path),
                dry_run=args.dry_run,
            )
        elif args.command == "db":
            if args.db_command == "migrate":
                migrate_db(DEFAULT_DB_PATH)
                result = {"migrated_to": "head", "db_path": str(DEFAULT_DB_PATH)}
            elif args.db_command == "drop":
                deleted = delete_db(DEFAULT_DB_PATH)
                result = {"deleted": deleted, "db_path": str(DEFAULT_DB_PATH)}
            elif args.db_command == "downgrade":
                downgrade_db(DEFAULT_DB_PATH, revision=args.revision)
                result = {"downgraded_to": args.revision, "db_path": str(DEFAULT_DB_PATH)}
            else:
                parser.parse_args([args.command, "--help"])
                return 1
        else:
            parser.print_help()
            return 1

        LOGGER.info("Command completed: %s", result)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as e:
        LOGGER.exception("Command failed")
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
