from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from prematch_from_db import get_due_slots_from_db, sync_1h_before_matches

ROOT = SRC_DIR.parent
DB_PATH = ROOT / "data" / "warehouse.duckdb"

app = FastAPI(title="Multi-League Odds & Match Results API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_con() -> duckdb.DuckDBPyConnection:
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail=f"Базата не е намерена: {DB_PATH}")
    return duckdb.connect(str(DB_PATH), read_only=True)


def _rows_to_dicts(
    cursor: duckdb.DuckDBPyConnection,
    sql: str,
    params: list[Any] | None = None,
) -> list[dict[str, Any]]:
    cur = cursor.execute(sql, params or [])
    cols = [desc[0] for desc in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "db_exists": DB_PATH.exists(),
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/sports")
def list_sports() -> dict[str, Any]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "mart_match_consensus_odds" in tables:
            rows = con.execute(
                "SELECT DISTINCT sport_key FROM mart_match_consensus_odds WHERE sport_key IS NOT NULL ORDER BY sport_key"
            ).fetchall()
        elif "stg_odds" in tables:
            rows = con.execute(
                "SELECT DISTINCT sport_key FROM stg_odds WHERE sport_key IS NOT NULL ORDER BY sport_key"
            ).fetchall()
        else:
            rows = []
        sports = [r[0] for r in rows]
        return {"count": len(sports), "sports": sports}
    finally:
        con.close()


@app.get("/api/matches")
def list_matches(
    sport_key: str | None = Query(default=None, description="Филтър по произволен турнир, напр. soccer_epl"),
    event_date: str | None = Query(default=None, description="YYYY-MM-DD"),
) -> dict[str, Any]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "mart_match_consensus_odds" not in tables:
            raise HTTPException(status_code=400, detail="Липсва таблица mart_match_consensus_odds")

        where: list[str] = []
        params: list[Any] = []

        if sport_key:
            where.append("sport_key = ?")
            params.append(sport_key)
        if event_date:
            where.append("CAST(event_date AS DATE) = CAST(? AS DATE)")
            params.append(event_date)

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        sql = f"""
            SELECT *
            FROM mart_match_consensus_odds
            {where_sql}
            ORDER BY commence_time_utc, sport_key, home_team, outcome_role
        """
        rows = _rows_to_dicts(con, sql, params)
        return {"count": len(rows), "matches": rows}
    finally:
        con.close()


@app.get("/api/matches/{event_id}/history")
def match_history(event_id: str) -> dict[str, Any]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "stg_odds" not in tables:
            raise HTTPException(status_code=400, detail="Липсва модел stg_odds")

        rows = _rows_to_dicts(
            con,
            """
            SELECT
                event_id,
                sport_key,
                commence_time_utc,
                home_team,
                away_team,
                bookmaker_key,
                bookmaker_title,
                outcome_role,
                outcome_name,
                odds_decimal,
                implied_probability,
                extracted_at_utc
            FROM stg_odds
            WHERE event_id = ?
            ORDER BY extracted_at_utc ASC, bookmaker_key ASC, outcome_role ASC
            """,
            [event_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Няма записи в историята за този event_id")

        return {"event_id": event_id, "count": len(rows), "history": rows}
    finally:
        con.close()


@app.get("/api/matches/{event_id}/comparison")
def compare_match_odds(event_id: str) -> dict[str, Any]:
    con = _get_con()
    try:
        rows = _rows_to_dicts(
            con,
            """
            WITH ranked AS (
                SELECT
                    event_id,
                    sport_key,
                    commence_time_utc,
                    home_team,
                    away_team,
                    bookmaker_key,
                    outcome_role,
                    outcome_name,
                    odds_decimal,
                    implied_probability,
                    extracted_at_utc,
                    ROW_NUMBER() OVER (
                        PARTITION BY event_id, bookmaker_key, outcome_role
                        ORDER BY extracted_at_utc ASC
                    ) AS rn_first,
                    ROW_NUMBER() OVER (
                        PARTITION BY event_id, bookmaker_key, outcome_role
                        ORDER BY extracted_at_utc DESC
                    ) AS rn_last
                FROM stg_odds
                WHERE event_id = ?
            )
            SELECT
                f.event_id,
                f.sport_key,
                f.home_team,
                f.away_team,
                f.bookmaker_key,
                f.outcome_role,
                f.outcome_name,
                f.extracted_at_utc AS first_seen_utc,
                l.extracted_at_utc AS last_seen_utc,
                f.odds_decimal AS first_odds,
                l.odds_decimal AS latest_odds,
                ROUND(l.odds_decimal - f.odds_decimal, 4) AS odds_diff,
                f.implied_probability AS first_prob,
                l.implied_probability AS latest_prob,
                ROUND((l.implied_probability - f.implied_probability) * 100, 2) AS prob_diff_pp
            FROM ranked f
            JOIN ranked l
              ON f.event_id = l.event_id
             AND f.bookmaker_key = l.bookmaker_key
             AND f.outcome_role = l.outcome_role
            WHERE f.rn_first = 1 AND l.rn_last = 1
            ORDER BY f.bookmaker_key, f.outcome_role
            """,
            [event_id],
        )
        return {"event_id": event_id, "count": len(rows), "comparison": rows}
    finally:
        con.close()


@app.get("/api/matches/{event_id}/result")
def match_result(event_id: str) -> dict[str, Any]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "mart_match_results" not in tables:
            return {
                "event_id": event_id,
                "status": "pending_post_match_module",
                "message": "Модулът за крайни резултати и победител ще бъде добавен след приключване на мачовете.",
            }

        rows = _rows_to_dicts(
            con,
            "SELECT * FROM mart_match_results WHERE event_id = ?",
            [event_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Няма краен резултат за този мач")
        return {"event_id": event_id, "result": rows[0]}
    finally:
        con.close()


@app.get("/api/prematch/due")
def prematch_due(
    window_minutes: int = Query(default=15, ge=1, le=120),
    sport_key: str | None = Query(default=None),
) -> dict[str, Any]:
    slots = get_due_slots_from_db(window_minutes=window_minutes, sport_key_filter=sport_key)
    return {"count": len(slots), "due_slots": slots}


@app.post("/api/prematch/sync")
def trigger_prematch_sync(
    window_minutes: int = Query(default=15, ge=1, le=120),
    sport_key: str | None = Query(default=None),
    dry_run: bool = Query(default=False),
) -> dict[str, Any]:
    return sync_1h_before_matches(
        window_minutes=window_minutes,
        sport_key=sport_key,
        dry_run=dry_run,
    )