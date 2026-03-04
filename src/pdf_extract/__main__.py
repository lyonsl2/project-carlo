"""CLI entry point for pdf_extract."""

import argparse
import json
import logging
import sys

from pdf_extract.storage import DEFAULT_DB_PATH, delete_db, downgrade_db, migrate_db
from pdf_extract.sync import extract_bulletin_text, fetch_bulletins, parse_bulletin_events, sync_bulletins

LOGGER = logging.getLogger(__name__)


def _configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )


def _run_sync_mode(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pdf_extract",
        description="Fetch bulletin PDFs, extract text, and parse events into SQLite.",
    )
    parser.add_argument(
        "--parish",
        help="Parish name (if omitted, sync runs for all parishes in DB)",
    )
    parser.add_argument(
        "--model",
        default="gpt-5-nano",
        help="OpenAI model for parse command/full sync (default: gpt-5-nano)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity (default: INFO)",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--migrate",
        action="store_true",
        help="Apply Alembic migrations and exit.",
    )
    mode_group.add_argument(
        "--delete-db",
        action="store_true",
        help="Delete the SQLite DB file and exit.",
    )
    mode_group.add_argument(
        "--downgrade",
        nargs="?",
        const="-1",
        help="Downgrade DB to revision (default: -1, one step back).",
    )
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("fetch", help="Fetch latest PDFs and save to disk/db")
    subparsers.add_parser("extract", help="Extract text from fetched PDFs")
    subparsers.add_parser("parse", help="Parse extracted text with OpenAI and save events")
    args = parser.parse_args(argv)
    _configure_logging(args.log_level)

    try:
        LOGGER.info("Starting command with log level %s", args.log_level)
        if args.delete_db:
            deleted = delete_db(DEFAULT_DB_PATH)
            LOGGER.info("Delete DB command completed (deleted=%s, path=%s)", deleted, DEFAULT_DB_PATH)
            print(json.dumps({"deleted": deleted, "db_path": str(DEFAULT_DB_PATH)}, indent=2))
            return 0
        if args.migrate:
            migrate_db(DEFAULT_DB_PATH)
            LOGGER.info("Migrate command completed (path=%s)", DEFAULT_DB_PATH)
            print(json.dumps({"migrated_to": "head", "db_path": str(DEFAULT_DB_PATH)}, indent=2))
            return 0
        if args.downgrade is not None:
            downgrade_db(DEFAULT_DB_PATH, revision=args.downgrade)
            LOGGER.info(
                "Downgrade command completed (revision=%s, path=%s)",
                args.downgrade,
                DEFAULT_DB_PATH,
            )
            print(
                json.dumps(
                    {"downgraded_to": args.downgrade, "db_path": str(DEFAULT_DB_PATH)},
                    indent=2,
                )
            )
            return 0

        if args.command == "fetch":
            result = fetch_bulletins(parish_name=args.parish)
        elif args.command == "extract":
            result = extract_bulletin_text(parish_name=args.parish)
        elif args.command == "parse":
            result = parse_bulletin_events(parish_name=args.parish, model=args.model)
        else:
            result = sync_bulletins(
                parish_name=args.parish,
                model=args.model,
            )
        LOGGER.info("Sync command completed: %s", result)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as e:
        LOGGER.exception("Command failed")
        print(f"Error during sync: {e}", file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    return _run_sync_mode(argv)


if __name__ == "__main__":
    sys.exit(main())
