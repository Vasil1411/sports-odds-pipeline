import asyncio
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

# Заключване на ниво процес, за да не се изпълняват едновременни sync заявки
_sync_lock = asyncio.Lock()


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


def _team_code(name: str | None) -> str:
    if not name:
        return "UNK"
    parts = [
        p
        for p in name.replace("&", " ").split()
        if p.lower() not in {"fc", "afc", "and", "of", "the"}
    ]
    if len(parts) >= 2:
        return "".join(p[0] for p in parts[:3]).upper()
    return parts[0][:3].upper()


def _query_matches_sync(
    sport_key: str | None = None,
    event_date: str | None = None,
) -> list[dict[str, Any]]:
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
        return _rows_to_dicts(con, sql, params)
    finally:
        con.close()


def _query_match_movement_sync(event_id: str) -> dict[str, Any]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "stg_odds" not in tables:
            raise HTTPException(status_code=400, detail="Липсва модел stg_odds")

        history_rows = _rows_to_dicts(
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
        if not history_rows:
            raise HTTPException(status_code=404, detail="Няма записи за този event_id")

        movement_rows = _rows_to_dicts(
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

        return {
            "event_id": event_id,
            "trend": history_rows,
            "movementRows": movement_rows,
        }
    finally:
        con.close()


def _query_results_sync(
    sport_key: str | None = None,
    event_date: str | None = None,
) -> list[dict[str, Any]]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "match_results" not in tables:
            return []

        where: list[str] = ["COALESCE(completed, FALSE) = TRUE"]
        params: list[Any] = []

        if sport_key:
            where.append("sport_key = ?")
            params.append(sport_key)
        if event_date:
            where.append("CAST(commence_time_utc AS DATE) = CAST(? AS DATE)")
            params.append(event_date)

        sql = f"""
            SELECT *
            FROM match_results
            WHERE {' AND '.join(where)}
            ORDER BY commence_time_utc DESC, fetched_at_utc DESC
        """
        return _rows_to_dicts(con, sql, params)
    finally:
        con.close()


def _build_post_match_summary_sync(
    event_date: str | None = None,
    sport_key: str | None = None,
    event_id: str | None = None,
) -> dict[str, Any] | None:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "match_results" not in tables:
            return None

        where: list[str] = ["COALESCE(completed, FALSE) = TRUE"]
        params: list[Any] = []

        if event_id:
            where.append("event_id = ?")
            params.append(event_id)
        else:
            if sport_key:
                where.append("sport_key = ?")
                params.append(sport_key)
            if event_date:
                where.append("CAST(commence_time_utc AS DATE) <= CAST(? AS DATE)")
                params.append(event_date)

        result_rows = _rows_to_dicts(
            con,
            f"""
            SELECT *
            FROM match_results
            WHERE {' AND '.join(where)}
            ORDER BY commence_time_utc DESC, fetched_at_utc DESC
            LIMIT 1
            """,
            params,
        )
        if not result_rows:
            return None

        res = result_rows[0]
        match_event_id = res["event_id"]

        odds_rows: list[dict[str, Any]] = []
        if "mart_match_consensus_odds" in tables:
            odds_rows = _rows_to_dicts(
                con,
                """
                SELECT outcome_role, outcome_name, avg_odds, avg_implied_prob
                FROM mart_match_consensus_odds
                WHERE event_id = ?
                """,
                [match_event_id],
            )

        winner_role = res.get("winner_role")
        home_score = res.get("home_score")
        away_score = res.get("away_score")

        if not winner_role and home_score is not None and away_score is not None:
            if home_score > away_score:
                winner_role = "home"
            elif away_score > home_score:
                winner_role = "away"
            else:
                winner_role = "draw"

        role_order = {"home": 0, "draw": 1, "away": 2}
        odds_by_role = {
            r["outcome_role"]: r for r in odds_rows if r.get("outcome_role")
        }

        outcomes: list[dict[str, Any]] = []
        for role, default_label in [
            ("home", res["home_team"]),
            ("draw", "Draw"),
            ("away", res["away_team"]),
        ]:
            o = odds_by_role.get(role)
            avg_odds = o.get("avg_odds") if o else None
            avg_prob = o.get("avg_implied_prob") if o else None
            label = o["outcome_name"] if o and o.get("outcome_name") else default_label
            outcomes.append(
                {
                    "_role": role,
                    "label": label,
                    "odds": f"{float(avg_odds):.2f}" if avg_odds is not None else "—",
                    "probability": f"{float(avg_prob) * 100:.1f}%" if avg_prob is not None else "—",
                    "won": bool(winner_role == role),
                }
            )

        outcomes.sort(key=lambda item: role_order.get(item["_role"], 99))
        for item in outcomes:
            item.pop("_role", None)

        home_name = res["home_team"]
        away_name = res["away_team"]
        score_str = (
            f"{home_score} - {away_score}"
            if home_score is not None and away_score is not None
            else "FT"
        )

        if winner_role == "home":
            headline = f"{home_name} full-time win"
        elif winner_role == "away":
            headline = f"{away_name} full-time win"
        else:
            headline = "Full-time draw"

        winner_outcome = next((item for item in outcomes if item["won"]), None)
        if winner_outcome and winner_outcome["odds"] != "—":
            description = (
                f"{home_name} finished {score_str} against {away_name}. "
                f"Winning pre-match consensus on {winner_outcome['label']} was "
                f"{winner_outcome['odds']} ({winner_outcome['probability']})."
            )
        else:
            description = f"{home_name} finished {score_str} against {away_name}."

        commence_str = str(res.get("commence_time_utc") or "")[:10]

        return {
            "event_id": match_event_id,
            "home": home_name,
            "homeCode": _team_code(home_name),
            "away": away_name,
            "awayCode": _team_code(away_name),
            "score": score_str,
            "date": commence_str,
            "tournament": res.get("sport_key") or "",
            "headline": headline,
            "description": description,
            "outcomes": outcomes,
        }
    finally:
        con.close()


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "db_exists": await asyncio.to_thread(DB_PATH.exists),
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/odds")
async def get_odds_dashboard(
    date: str | None = Query(default=None, description="YYYY-MM-DD"),
    sport_key: str | None = Query(default=None),
) -> dict[str, Any]:
    matches = await asyncio.to_thread(_query_matches_sync, sport_key, date)
    tournaments = sorted({m["sport_key"] for m in matches if m.get("sport_key")})
    last_sync_utc = max(
        (str(m["extracted_at_utc"]) for m in matches if m.get("extracted_at_utc")),
        default=None,
    )
    post_match = await asyncio.to_thread(
        _build_post_match_summary_sync,
        date,
        sport_key,
    )
    return {
        "matches": matches,
        "tournaments": tournaments,
        "lastSyncUtc": last_sync_utc,
        "postMatch": post_match,
    }


@app.get("/api/results")
async def list_results(
    sport_key: str | None = Query(default=None),
    event_date: str | None = Query(default=None, description="YYYY-MM-DD"),
) -> dict[str, Any]:
    results = await asyncio.to_thread(_query_results_sync, sport_key, event_date)
    return {"count": len(results), "results": results}


@app.get("/api/odds/{match_id}/movement")
async def get_match_movement_endpoint(match_id: str) -> dict[str, Any]:
    return await asyncio.to_thread(_query_match_movement_sync, match_id)


@app.get("/api/matches")
async def list_matches(
    sport_key: str | None = Query(default=None, description="Филтър по произволен турнир, напр. soccer_epl"),
    event_date: str | None = Query(default=None, description="YYYY-MM-DD"),
) -> dict[str, Any]:
    matches = await asyncio.to_thread(_query_matches_sync, sport_key, event_date)
    return {"count": len(matches), "matches": matches}


@app.get("/api/matches/{event_id}/history")
async def match_history(event_id: str) -> dict[str, Any]:
    data = await asyncio.to_thread(_query_match_movement_sync, event_id)
    return {"event_id": event_id, "count": len(data["trend"]), "history": data["trend"]}


@app.get("/api/matches/{event_id}/comparison")
async def compare_match_odds(event_id: str) -> dict[str, Any]:
    data = await asyncio.to_thread(_query_match_movement_sync, event_id)
    return {"event_id": event_id, "count": len(data["movementRows"]), "comparison": data["movementRows"]}


@app.get("/api/prematch/due")
async def prematch_due(
    window_minutes: int = Query(default=15, ge=1, le=120),
    sport_key: str | None = Query(default=None),
) -> dict[str, Any]:
    slots = await asyncio.to_thread(
        get_due_slots_from_db,
        window_minutes=window_minutes,
        sport_key_filter=sport_key,
    )
    return {"count": len(slots), "due_slots": slots}


@app.post("/api/sync")
@app.post("/api/prematch/sync")
async def trigger_prematch_sync(
    window_minutes: int = Query(default=15, ge=1, le=120),
    sport_key: str | None = Query(default=None),
    dry_run: bool = Query(default=False),
) -> dict[str, Any]:
    async with _sync_lock:
        return await asyncio.to_thread(
            sync_1h_before_matches,
            window_minutes=window_minutes,
            sport_key=sport_key,
            dry_run=dry_run,
        )




def _query_calibration_summary_sync(
    sport_key: str | None = None,
) -> list[dict[str, Any]]:
    con = _get_con()
    try:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "mart_h2h_league_role_summary" not in tables:
            return []

        where: list[str] = []
        params: list[Any] = []
        if sport_key:
            where.append("sport_key = ?")
            params.append(sport_key)

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        sql = f"""
            SELECT
                sport_key,
                outcome_role,
                CAST(first_match_date AS VARCHAR) AS first_match_date,
                CAST(last_match_date AS VARCHAR) AS last_match_date,
                active_match_days,
                match_dates_list,
                evaluated_rows,
                unique_matches,
                favorite_picks,
                favorite_wins,
                favorite_hit_rate,
                avg_winning_odds,
                avg_raw_implied_prob,
                avg_norm_implied_prob,
                actual_win_rate,
                actual_minus_norm_prob,
                avg_total_goals,
                avg_goal_diff,
                blowout_2plus_rate,
                avg_event_odds_gap
            FROM mart_h2h_league_role_summary
            {where_sql}
            ORDER BY sport_key, outcome_role
        """
        return _rows_to_dicts(con, sql, params)
    finally:
        con.close()


@app.get("/api/calibration/summary")
async def get_calibration_summary(
    sport_key: str | None = Query(default=None),
) -> dict[str, Any]:
    rows = await asyncio.to_thread(_query_calibration_summary_sync, sport_key)
    return {"count": len(rows), "summary": rows}