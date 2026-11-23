import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

UEFA_SPORTS = [
    "soccer_uefa_champs_league",
    "soccer_uefa_europa_league",
    "soccer_uefa_europa_conference_league",
]


class Outcome(BaseModel):
    name: str
    price: float


class Market(BaseModel):
    key: str
    outcomes: list[Outcome]


class Bookmaker(BaseModel):
    key: str
    title: str
    markets: list[Market]


class EventOdds(BaseModel):
    id: str
    sport_key: str
    commence_time: str
    home_team: str
    away_team: str
    bookmakers: list[Bookmaker]


def fetch_and_save_odds(
    sport: str = "soccer_epl",
    regions: str = "eu",
    markets: str = "h2h",
    run_date: str | None = None,
    merge_existing: bool = True,
) -> Path:
    api_key = os.getenv("ODDS_API_KEY")
    if not api_key:
        raise ValueError("Липсва ODDS_API_KEY в .env файла.")

    url = f"https://api.the-odds-api.com/v4/sports/{sport}/odds/"
    params = {
        "apiKey": api_key,
        "regions": regions,
        "markets": markets,
        "oddsFormat": "decimal",
    }

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()

    remaining = response.headers.get("x-requests-remaining", "unknown")
    used = response.headers.get("x-requests-used", "unknown")
    print(f"[{sport}] Успешно! Използвани: {used} | Оставащи кредити: {remaining}")

    payload = response.json()
    validated_events = [EventOdds.model_validate(item) for item in payload]
    print(f"[{sport}] Валидирани събития: {len(validated_events)}")

    now_utc = datetime.now(timezone.utc)
    extracted_iso = now_utc.isoformat()
    snap_ts = now_utc.strftime("%Y%m%dT%H%M%SZ")

    target_date = run_date or now_utc.strftime("%Y-%m-%d")
    out_dir = ROOT / "data" / "raw" / "odds" / f"date={target_date}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) Пазим исторически snapshot за всяко пускане (не се презаписва)
    snap_dir = out_dir / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    snap_file = snap_dir / f"{snap_ts}_{sport}.json"
    snap_record = {
        "extracted_at_utc": extracted_iso,
        "sport": sport,
        "regions": regions,
        "markets": markets,
        "events": [e.model_dump() for e in validated_events],
    }
    snap_file.write_text(json.dumps(snap_record, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Записан snapshot в историята: {snap_file}")

    # 2) Актуализираме и текущия odds.json за съвместимост
    out_file = out_dir / "odds.json"
    events_by_id: dict[str, dict] = {}
    if merge_existing and out_file.exists():
        existing_data = json.loads(out_file.read_text(encoding="utf-8"))
        for ev in existing_data.get("events", []):
            if "id" in ev:
                events_by_id[ev["id"]] = ev

    for ev in validated_events:
        dumped = ev.model_dump()
        events_by_id[dumped["id"]] = dumped

    record = {
        "extracted_at_utc": extracted_iso,
        "sports_updated": sport,
        "regions": regions,
        "markets": markets,
        "events": list(events_by_id.values()),
    }
    out_file.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Обновен текущ файл: {out_file} (общо събития: {len(events_by_id)})")
    return snap_file


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch odds from The Odds API and save history snapshots.")
    parser.add_argument("--sport", default="soccer_epl", help="Sport key (напр. soccer_uefa_champs_league)")
    parser.add_argument("--regions", default="eu")
    parser.add_argument("--markets", default="h2h")
    parser.add_argument("--date", default=None, help="Папка date=YYYY-MM-DD (по подразбиране днешната UTC дата)")
    parser.add_argument("--no-merge", action="store_true", help="Презапиши odds.json вместо да обединяваш по event id")
    args = parser.parse_args()

    fetch_and_save_odds(
        sport=args.sport,
        regions=args.regions,
        markets=args.markets,
        run_date=args.date,
        merge_existing=not args.no_merge,
    )