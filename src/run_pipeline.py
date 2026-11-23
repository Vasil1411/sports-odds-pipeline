import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UEFA_SPORTS = [
    "soccer_uefa_champs_league",
    "soccer_uefa_europa_league",
    "soccer_uefa_europa_conference_league",
]


def run(cmd: list[str]) -> None:
    print("->", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    default_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=default_date, help="Дата на raw партицията YYYY-MM-DD")
    parser.add_argument("--skip-ingest", action="store_true", help="Не харчи кредити от API, ползва съществуващия raw файл")
    args = parser.parse_args()

    ingest_script = str(ROOT / "src" / "ingest_odds.py")
    silver_script = str(ROOT / "src" / "transform_silver.py")

    if not args.skip_ingest:
        for sport in UEFA_SPORTS:
            run([sys.executable, ingest_script, "--sport", sport, "--date", args.date])

    run([sys.executable, silver_script, "--date", args.date])
    run([sys.executable, "-m", "dbt.cli.main", "run", "--profiles-dir", ".", "--no-partial-parse"])
    run([sys.executable, "-m", "dbt.cli.main", "test", "--profiles-dir", "."])

    export_code = (
        "import duckdb, pandas as pd; "
        "con = duckdb.connect('data/warehouse.duckdb', read_only=True); "
        "df = con.execute(\"SELECT * FROM mart_match_consensus_odds WHERE sport_key IN ('soccer_uefa_champs_league','soccer_uefa_europa_league','soccer_uefa_europa_conference_league') ORDER BY event_date, sport_key, commence_time_utc, home_team, outcome_role\").fetchdf(); "
        "df.to_excel('data/uefa_matches.xlsx', index=False); "
        "print('Експортирано в data/uefa_matches.xlsx:', len(df), 'реда')"
    )
    run([sys.executable, "-c", export_code])


if __name__ == "__main__":
    main()