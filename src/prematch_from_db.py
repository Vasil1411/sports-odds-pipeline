import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys

import duckdb

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from ingest_odds import fetch_and_save_odds

ROOT = SRC_DIR.parent
DB_PATH = ROOT / "data" / "warehouse.duckdb"
STATE_FILE = ROOT / "data" / "prematch_db_triggers.json"


def _to_utc(dt_val) -> datetime | None:
    if dt_val is None:
        return None
    if isinstance(dt_val, str):
        dt_val = datetime.fromisoformat(dt_val.replace("Z", "+00:00"))
    if dt_val.tzinfo is None:
        return dt_val.replace(tzinfo=timezone.utc)
    return dt_val.astimezone(timezone.utc)


def get_due_slots_from_db(
    now_utc: datetime | None = None,
    window_minutes: int = 59,
    db_path: Path = DB_PATH,
    sport_key_filter: str | None = None,
) -> list[dict]:
    """
    Взима всички мачове от DuckDB (независимо от турнира) и връща слотовете,
    които попадат в интервала от 1 час преди началото до 1 минута преди началото.
    """
    current_utc = _to_utc(now_utc) or datetime.now(timezone.utc)
    if not db_path.exists():
        return []

    con = duckdb.connect(str(db_path), read_only=True)
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        where_clauses: list[str] = []
        params: list[str] = []

        if sport_key_filter:
            where_clauses.append("sport_key = ?")
            params.append(sport_key_filter)

        if "mart_match_consensus_odds" in tables:
            where_clauses.append("commence_time_utc IS NOT NULL")
            sql = f"""
                SELECT DISTINCT event_id, sport_key, commence_time_utc, home_team, away_team
                FROM mart_match_consensus_odds
                WHERE {' AND '.join(where_clauses)}
            """
            rows = con.execute(sql, params).fetchall()
        elif "stg_odds" in tables:
            where_clauses.append("commence_time_utc IS NOT NULL")
            sql = f"""
                SELECT DISTINCT event_id, sport_key, commence_time_utc, home_team, away_team
                FROM stg_odds
                WHERE {' AND '.join(where_clauses)}
            """
            rows = con.execute(sql, params).fetchall()
        else:
            return []
    finally:
        con.close()

    grouped_by_kickoff: dict[datetime, dict] = {}
    for _event_id, sport_key, commence_raw, home_team, away_team in rows:
        if not sport_key:
            continue
        kickoff_utc = _to_utc(commence_raw)
        if not kickoff_utc:
            continue

        window_start_utc = kickoff_utc - timedelta(hours=1)
        window_end_utc = kickoff_utc - timedelta(minutes=1)
        if kickoff_utc not in grouped_by_kickoff:
            grouped_by_kickoff[kickoff_utc] = {
                "kickoff_utc": kickoff_utc,
                "window_start_utc": window_start_utc,
                "window_end_utc": window_end_utc,
                "sports": set(),
                "matches": set(),
            }
        grouped_by_kickoff[kickoff_utc]["sports"].add(sport_key)
        grouped_by_kickoff[kickoff_utc]["matches"].add(f"{home_team} vs {away_team}")

    due: list[dict] = []
    for kickoff_utc in sorted(grouped_by_kickoff.keys()):
        item = grouped_by_kickoff[kickoff_utc]
        # По желание window_minutes може допълнително да ограничи максималната дължина на прозореца (до 59 мин)
        effective_end_utc = min(
            item["window_end_utc"],
            item["window_start_utc"] + timedelta(minutes=max(1, min(window_minutes, 59))),
        )
        if item["window_start_utc"] <= current_utc <= effective_end_utc:
            due.append(
                {
                    "kickoff_utc": item["kickoff_utc"].isoformat(),
                    "trigger_utc": item["window_start_utc"].isoformat(),
                    "window_end_utc": effective_end_utc.isoformat(),
                    "sports": sorted(item["sports"]),
                    "match_count": len(item["matches"]),
                }
            )
    return due


def _load_fired() -> set[str]:
    if not STATE_FILE.exists():
        return set()
    try:
        return set(json.loads(STATE_FILE.read_text(encoding="utf-8")))
    except Exception:
        return set()


def _save_fired(fired: set[str]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(sorted(fired), indent=2), encoding="utf-8")


def _rebuild_db_and_history(raw_date: str) -> None:
    silver_script = str(ROOT / "src" / "transform_silver.py")
    subprocess.run([sys.executable, silver_script, "--date", raw_date], cwd=ROOT, check=True)
    subprocess.run(
        [sys.executable, "-m", "dbt.cli.main", "run", "--profiles-dir", ".", "--no-partial-parse"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [sys.executable, "-m", "dbt.cli.main", "test", "--profiles-dir", "."],
        cwd=ROOT,
        check=True,
    )


def sync_1h_before_matches(
    now_utc: datetime | None = None,
    window_minutes: int = 59,
    regions: str = "eu",
    markets: str = "h2h",
    sport_key: str | None = None,
    dry_run: bool = False,
) -> dict:
    """
    Проверява всички мачове в базата и ако текущият момент е между 1 час и 1 минута
    преди началото на мача и данните още не са взети за слота, вика fetch_and_save_odds(),
    записва историята и обновява базата.
    """
    current_utc = _to_utc(now_utc) or datetime.now(timezone.utc)
    run_date = current_utc.strftime("%Y-%m-%d")
    due_slots = get_due_slots_from_db(
        now_utc=current_utc,
        window_minutes=window_minutes,
        sport_key_filter=sport_key,
    )
    fired = _load_fired()
    ran: list[dict] = []

    for slot in due_slots:
        key = f"{slot['trigger_utc']}|{'|'.join(slot['sports'])}"
        if key in fired:
            continue

        if not dry_run:
            for sport in slot["sports"]:
                fetch_and_save_odds(
                    sport=sport,
                    regions=regions,
                    markets=markets,
                    run_date=run_date,
                    merge_existing=True,
                )
            _rebuild_db_and_history(run_date)
            fired.add(key)
            _save_fired(fired)

        ran.append({**slot, "dry_run": dry_run})

    return {
        "checked_at_utc": current_utc.isoformat(),
        "run_date": run_date,
        "triggered_slots": len(ran),
        "slots": ran,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Изпълнение от 1 час до 1 минута преди мачовете от базата (веднъж на слот)."
    )
    parser.add_argument("--window-minutes", type=int, default=59)
    parser.add_argument("--sport-key", default=None, help="Незадължителен филтър само за един турнир")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(
        json.dumps(
            sync_1h_before_matches(
                window_minutes=args.window_minutes,
                sport_key=args.sport_key,
                dry_run=args.dry_run,
            ),
            indent=2,
            ensure_ascii=False,
        )
    )