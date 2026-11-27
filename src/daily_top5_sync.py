import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from ingest_odds import fetch_and_save_odds
from prematch_from_db import _rebuild_db_and_history

TOP_5_SPORTS = [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_italy_serie_a",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
]


def sync_top5_daily(
    sports: list[str] | None = None,
    regions: str = "eu",
    markets: str = "h2h",
    run_date: str | None = None,
    rebuild_db: bool = True,
    dry_run: bool = False,
) -> dict:
    target_sports = sports or TOP_5_SPORTS
    now_utc = datetime.now(timezone.utc)
    target_date = run_date or now_utc.strftime("%Y-%m-%d")
    synced: list[str] = []

    if not dry_run:
        for sport in target_sports:
            fetch_and_save_odds(
                sport=sport,
                regions=regions,
                markets=markets,
                run_date=target_date,
                merge_existing=True,
            )
            synced.append(sport)

        if rebuild_db:
            _rebuild_db_and_history(target_date)

    return {
        "checked_at_utc": now_utc.isoformat(),
        "run_date": target_date,
        "dry_run": dry_run,
        "sports_synced": synced,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Daily sync of new and existing matches across Top 5 European football leagues."
    )
    parser.add_argument(
        "--sports",
        nargs="+",
        default=TOP_5_SPORTS,
        help="Списък от sport_key кодове (по подразбиране топ 5 лиги)",
    )
    parser.add_argument("--regions", default="eu")
    parser.add_argument("--markets", default="h2h")
    parser.add_argument("--date", default=None, help="YYYY-MM-DD (по подразбиране днешната UTC дата)")
    parser.add_argument("--no-rebuild", action="store_true", help="Пропусни transform_silver и dbt")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = sync_top5_daily(
        sports=args.sports,
        regions=args.regions,
        markets=args.markets,
        run_date=args.date,
        rebuild_db=not args.no_rebuild,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))