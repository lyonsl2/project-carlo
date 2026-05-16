"""CLI entry point for pdf_extract."""

import argparse
import json
import logging
import sys

from pdf_extract.storage import DEFAULT_DB_PATH

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


def _ensure_db() -> None:
    """Rebuild the DB from data files before running a pipeline command."""
    from pdf_extract.db import create_db
    create_db(DEFAULT_DB_PATH)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pdf_extract",
        description="Fetch bulletin PDFs, process events, and manage parish data.",
    )
    subparsers = parser.add_subparsers(dest="command")

    # -- fetch --
    fetch_parser = subparsers.add_parser("fetch", help="Fetch latest PDFs and save to disk")
    fetch_parser.add_argument("--parish", help="Parish name (omit to run for all)")
    _add_common_args(fetch_parser)

    # -- process --
    process_parser = subparsers.add_parser("process", help="Process fetched PDFs with Gemini")
    process_parser.add_argument("--parish", help="Parish name (omit to run for all)")
    process_parser.add_argument("--model", default="gemini-3-flash-preview", help="Gemini model (default: gemini-3-flash-preview)")
    process_parser.add_argument(
        "--concurrency", type=int, default=5,
        help="Number of parallel Gemini calls (default: 5)",
    )
    _add_common_args(process_parser)

    # -- extract (experimental: run a registered classifier into data/runs/) --
    extract_parser = subparsers.add_parser(
        "extract",
        help="Run an experimental classifier and write to data/runs/<name>/",
    )
    extract_parser.add_argument(
        "--classifier", required=True,
        help="Name of the registered classifier (see pdf_extract.classifiers.REGISTRY)",
    )
    extract_parser.add_argument("--parish", help="Parish name (omit to run for all)")
    extract_parser.add_argument(
        "--concurrency", type=int, default=5,
        help="Number of parallel classifier calls (default: 5)",
    )
    _add_common_args(extract_parser)

    # -- compare (experimental: pairwise metrics over previous extract runs) --
    compare_parser = subparsers.add_parser(
        "compare",
        help="Compare two or more classifier runs from data/runs/",
    )
    compare_parser.add_argument(
        "classifiers", nargs="+",
        help="Two or more classifier names to compare (must each have a run dir)",
    )
    compare_parser.add_argument(
        "--out", type=str, default=None,
        help="Optional path for the JSON report (default: data/runs/compare/compare_<ts>.json)",
    )
    _add_common_args(compare_parser)

    # -- detect --
    detect_parser = subparsers.add_parser("detect", help="Detect bulletin provider for parish websites")
    detect_subparsers = detect_parser.add_subparsers(dest="detect_command")

    detect_run_parser = detect_subparsers.add_parser("run", help="Run provider detection")
    detect_run_parser.add_argument("--dry-run", action="store_true")
    detect_run_parser.add_argument("--limit", type=int, default=None)
    detect_run_parser.add_argument("--pause-seconds", type=float, default=0.5)
    _add_common_args(detect_run_parser)

    detect_apply_parser = detect_subparsers.add_parser("apply", help="Write detect results into parishes.csv")
    _add_common_args(detect_apply_parser)

    # -- verify --
    verify_parser = subparsers.add_parser("verify", help="Verify church data against latest bulletin")
    verify_subparsers = verify_parser.add_subparsers(dest="verify_command")

    verify_run_parser = verify_subparsers.add_parser("run", help="Run church verification")
    verify_run_parser.add_argument("--parish", help="Parish name (omit for all)")
    verify_run_parser.add_argument("--model", default="gemini-3-flash-preview", help="Gemini model (default: gemini-3-flash-preview)")
    _add_common_args(verify_run_parser)

    verify_apply_parser = verify_subparsers.add_parser("apply", help="Write verify results into churches.csv")
    _add_common_args(verify_apply_parser)

    # -- geocode --
    geocode_parser = subparsers.add_parser("geocode", help="Backfill church lat/lng from address")
    geocode_subparsers = geocode_parser.add_subparsers(dest="geocode_command")

    geocode_run_parser = geocode_subparsers.add_parser("run", help="Run geocoding via Nominatim")
    geocode_run_parser.add_argument("--dry-run", action="store_true")
    geocode_run_parser.add_argument("--limit", type=int, default=None)
    geocode_run_parser.add_argument("--pause-seconds", type=float, default=1.0)
    geocode_run_parser.add_argument("--email", type=str, default=None, help="Email for Nominatim usage policy")
    _add_common_args(geocode_run_parser)

    geocode_apply_parser = geocode_subparsers.add_parser("apply", help="Write geocode results into churches.csv")
    _add_common_args(geocode_apply_parser)

    # -- db --
    db_parser = subparsers.add_parser("db", help="Database management commands")
    db_subparsers = db_parser.add_subparsers(dest="db_command")

    db_create_parser = db_subparsers.add_parser("create", help="Drop and recreate DB from schema + data files")
    _add_common_args(db_create_parser)

    db_drop_parser = db_subparsers.add_parser("drop", help="Delete the SQLite DB file")
    _add_common_args(db_drop_parser)

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
            _ensure_db()
            from pdf_extract.fetch import fetch_bulletins
            result = fetch_bulletins(parish_name=args.parish)

        elif args.command == "process":
            _ensure_db()
            from pdf_extract.process import process_bulletins
            result = process_bulletins(
                parish_name=args.parish, model=args.model, concurrency=args.concurrency,
            )

        elif args.command == "extract":
            _ensure_db()
            from pdf_extract.extract_run import run as run_extract
            result = run_extract(
                classifier_name=args.classifier,
                parish_name=args.parish,
                concurrency=args.concurrency,
            )

        elif args.command == "compare":
            from pathlib import Path as _Path
            from pdf_extract.compare import compare as run_compare
            result = run_compare(
                args.classifiers,
                out_path=_Path(args.out) if args.out else None,
            )

        elif args.command == "detect":
            if args.detect_command == "run":
                _ensure_db()
                from pdf_extract.detect import run_detection
                result = run_detection(
                    db_path=DEFAULT_DB_PATH,
                    dry_run=args.dry_run,
                    limit=args.limit,
                    pause_seconds=args.pause_seconds,
                )
            elif args.detect_command == "apply":
                from pdf_extract.apply import apply_detect_results
                result = apply_detect_results()
            else:
                parser.parse_args(["detect", "--help"])
                return 1

        elif args.command == "verify":
            if args.verify_command == "run":
                _ensure_db()
                from pdf_extract.verify import verify_churches
                result = verify_churches(parish_name=args.parish, model=args.model)
            elif args.verify_command == "apply":
                from pdf_extract.apply import apply_verify_results
                result = apply_verify_results()
            else:
                parser.parse_args(["verify", "--help"])
                return 1

        elif args.command == "geocode":
            if args.geocode_command == "run":
                _ensure_db()
                from pdf_extract.geocode import run_backfill
                result = run_backfill(
                    dry_run=args.dry_run,
                    limit=args.limit,
                    pause_seconds=args.pause_seconds,
                    email=args.email,
                )
            elif args.geocode_command == "apply":
                from pdf_extract.apply import apply_geocode_results
                result = apply_geocode_results()
            else:
                parser.parse_args(["geocode", "--help"])
                return 1

        elif args.command == "db":
            if args.db_command == "create":
                from pdf_extract.db import create_db
                result = create_db(DEFAULT_DB_PATH)
            elif args.db_command == "drop":
                from pdf_extract.storage import delete_db
                deleted = delete_db(DEFAULT_DB_PATH)
                result = {"deleted": deleted, "db_path": str(DEFAULT_DB_PATH)}
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
