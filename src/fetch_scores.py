from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import duckdb
import requests
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "warehouse.duckdb"
OUT_DIR = ROOT / "data" / "bronze" / "scores"


def get_pending_sports_and_events(con: duckdb.DuckDBPyConnection) -> tuple[list[str], set[str]]:
    con.execute("""
        CREATE TABLE IF NOT EXISTS match_results (
            event_id VARCHAR PRIMARY KEY,
            sport_key VARCHAR,
            commence_time_utc TIMESTAMP,
            completed BOOLEAN,
            home_team VARCHAR,
            away_team VARCHAR,
            home_score INTEGER,
            away_score INTEGER,
            winner_role VARCHAR,
            fetched_at_utc TIMESTAMP
        )
    """)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=2)

    rows = con.execute(
        """
        SELECT DISTINCT o.event_id, o.sport_key
        FROM stg_odds o
        LEFT JOIN match_results r ON o.event_id = r.event_id
        WHERE o.commence_time_utc <= ?
          AND r.event_id IS NULL
        """,
        [cutoff.replace(tzinfo=None)],
    ).fetchall()

    event_ids = {str(r[0]) for r in rows if r[0]}
    sports = sorted({str(r[1]) for r in rows if r[1]})
    return sports, event_ids


def resolve_winner(
    scores: list[dict[str, Any]] | None,
    home_team: str,
    away_team: str,
) -> tuple[int | None, int | None, str]:
    if not scores or len(scores) < 2:
        return None, None, "unknown"

    by_name: dict[str, Any] = {
        str(item.get("name", "")): item.get("score") for item in scores
    }
    raw_home = by_name.get(home_team)
    raw_away = by_name.get(away_team)

    if raw_home is None or raw_away is None:
        return None, None, "unknown"

    try:
        h_score = int(str(raw_home))
        a_score = int(str(raw_away))
    except (ValueError, TypeError):
        return None, None, "unknown"

    if h_score > a_score:
        return h_score, a_score, "home"
    if a_score > h_score:
        return h_score, a_score, "away"
    return h_score, a_score, "draw"

def main() -> None:
    api_key = os.getenv("ODDS_API_KEY")
    if not api_key:
        raise RuntimeError("Липсва ODDS_API_KEY")

    if not DB_PATH.exists():
        print("Базата не съществува, пропускам.")
        return

    con = duckdb.connect(str(DB_PATH))
    try:
        sports, pending_event_ids = get_pending_sports_and_events(con)
        if not pending_event_ids or not sports:
            print("Няма мачове без записани резултати. Заявки не са правени.")
            return

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        now_utc = datetime.now(timezone.utc)
        saved_count = 0

        for sport_key in sports:
            url = f"https://api.the-odds-api.com/v4/sports/{sport_key}/scores"
            resp = requests.get(
                url,
                params={"apiKey": api_key, "daysFrom": 2, "dateFormat": "iso"},
                timeout=30,
            )
            resp.raise_for_status()
            payload = resp.json()

            raw_file = OUT_DIR / f"{sport_key}_{now_utc.strftime('%Y%m%dT%H%M%SZ')}.json"
            raw_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

            for ev in payload:
                ev_id = str(ev.get("id", ""))
                if ev_id not in pending_event_ids or not ev.get("completed"):
                    continue

                home_team = str(ev.get("home_team", ""))
                away_team = str(ev.get("away_team", ""))
                h_score, a_score, winner = resolve_winner(ev.get("scores"), home_team, away_team)

                con.execute(
                    """
                    INSERT OR REPLACE INTO match_results (
                        event_id, sport_key, commence_time_utc, completed,
                        home_team, away_team, home_score, away_score,
                        winner_role, fetched_at_utc
                    ) VALUES (?, ?, CAST(? AS TIMESTAMP), ?, ?, ?, ?, ?, ?, CAST(? AS TIMESTAMP))
                    """,
                    [
                        ev_id,
                        sport_key,
                        str(ev.get("commence_time", "")).replace("Z", "+00:00"),
                        bool(ev.get("completed")),
                        home_team,
                        away_team,
                        h_score,
                        a_score,
                        winner,
                        now_utc.replace(tzinfo=None).isoformat(),
                    ],
                )
                saved_count += 1

        print(f"Готово. Записани резултати за {saved_count} мача.")
    finally:
        con.close()


if __name__ == "__main__":
    main()