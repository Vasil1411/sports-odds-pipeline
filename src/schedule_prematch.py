import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "data" / "prematch_fired_triggers.json"


def load_kickoff_slots_from_silver(silver_root: Path, raw_date: str) -> list[dict]:
    """Събира уникалните часове на мачовете (>= raw_date) и вади 1 час за тригърване."""
    slots_map: dict[datetime, dict] = {}

    for jsonl_file in sorted(silver_root.glob("event_date=*/*.jsonl")):
        part_date = jsonl_file.parent.name.replace("event_date=", "")
        if part_date < raw_date:
            continue

        for line in jsonl_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            ct_raw = row.get("commence_time")
            if not ct_raw:
                continue

            kickoff_utc = datetime.fromisoformat(ct_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
            trigger_utc = kickoff_utc - timedelta(hours=1)

            if kickoff_utc not in slots_map:
                slots_map[kickoff_utc] = {
                    "kickoff_utc": kickoff_utc,
                    "trigger_utc": trigger_utc,
                    "sports": set(),
                    "matches": set(),
                }
            if row.get("sport_key"):
                slots_map[kickoff_utc]["sports"].add(row["sport_key"])
            label = f"{row.get('home_team', '?')} vs {row.get('away_team', '?')}"
            slots_map[kickoff_utc]["matches"].add(label)

    result = []
    for kickoff_utc in sorted(slots_map.keys()):
        item = slots_map[kickoff_utc]
        result.append(
            {
                "kickoff_utc": kickoff_utc,
                "trigger_utc": item["trigger_utc"],
                "sports": sorted(item["sports"]),
                "match_count": len(item["matches"]),
                "matches": sorted(item["matches"]),
            }
        )
    return result


def load_fired_triggers() -> set[str]:
    if not STATE_FILE.exists():
        return set()
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return set(data if isinstance(data, list) else [])
    except Exception:
        return set()


def save_fired_triggers(fired: set[str]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(sorted(fired), indent=2), encoding="utf-8")


def run_update_for_sports(sports: list[str], raw_date: str) -> None:
    ingest_script = str(ROOT / "src" / "ingest_odds.py")
    silver_script = str(ROOT / "src" / "transform_silver.py")

    for sport in sports:
        subprocess.run(
            [sys.executable, ingest_script, "--sport", sport, "--date", raw_date],
            cwd=ROOT,
            check=True,
        )

    subprocess.run(
        [sys.executable, silver_script, "--date", raw_date],
        cwd=ROOT,
        check=True,
    )
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

    export_code = (
        "import duckdb, pandas as pd; "
        "con = duckdb.connect('data/warehouse.duckdb', read_only=True); "
        "df = con.execute(\"SELECT * FROM mart_match_consensus_odds WHERE sport_key IN ('soccer_uefa_champs_league','soccer_uefa_europa_league','soccer_uefa_europa_conference_league') ORDER BY event_date, sport_key, commence_time_utc, home_team, outcome_role\").fetchdf(); "
        "df.to_excel('data/uefa_matches.xlsx', index=False); "
        "print('Обновен data/uefa_matches.xlsx:', len(df), 'реда')"
    )
    subprocess.run([sys.executable, "-c", export_code], cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Тригър '1 час преди мача' по часовете на срещите.")
    parser.add_argument("--raw-date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    parser.add_argument("--dry-run", action="store_true", help="Само показва часовите прозорци без да пуска API/pipeline")
    parser.add_argument("--watch", action="store_true", help="Следи текущото време и пуска автоматично при настъпване на trigger_utc")
    parser.add_argument("--window-minutes", type=int, default=10, help="Допустим прозорец около trigger_utc (в минути)")
    args = parser.parse_args()

    slots = load_kickoff_slots_from_silver(ROOT / "data" / "silver" / "odds", args.raw_date)
    if not slots:
        print("Няма намерени мачове с commence_time в data/silver/odds.")
        return

    print(f"Намерени {len(slots)} уникални часа на начало на мачове:")
    for s in slots:
        print(
            f"  Начало (UTC): {s['kickoff_utc'].strftime('%Y-%m-%d %H:%M')} | "
            f"Тригър (-1ч): {s['trigger_utc'].strftime('%Y-%m-%d %H:%M')} | "
            f"Мачове: {s['match_count']} | Турнири: {', '.join(s['sports'])}"
        )

    if args.dry_run:
        return

    fired_triggers = load_fired_triggers()

    while True:
        now_utc = datetime.now(timezone.utc)
        for s in slots:
            trig_key = f"{s['trigger_utc'].isoformat()}|{'|'.join(s['sports'])}"
            delta = (now_utc - s["trigger_utc"]).total_seconds()
            if trig_key not in fired_triggers and 0 <= delta <= args.window_minutes * 60:
                print(
                    f"[{now_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}] Настъпи прозорец -1ч за мачовете в "
                    f"{s['kickoff_utc'].strftime('%H:%M UTC')} ({s['match_count']} мача)."
                )
                run_update_for_sports(s["sports"], args.raw_date)
                fired_triggers.add(trig_key)
                save_fired_triggers(fired_triggers)

        if not args.watch:
            break
        time.sleep(60)


if __name__ == "__main__":
    main()