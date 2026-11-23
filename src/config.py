from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

COMPETITIONS: dict[str, str] = {
    "ucl": "soccer_uefa_champs_league",
    "uel": "soccer_uefa_europa_league",
    "uecl": "soccer_uefa_europa_conference_league",
}

def get_target_dates(start_str: str | None = None, days: int = 3) -> list[str]:
    """Връща датите за утре, другиден и по-другиден (3 дни от утре по UTC)."""
    if start_str:
        start_dt = datetime.strptime(start_str, "%Y-%m-%d").date()
    else:
        start_dt = datetime.now(timezone.utc).date() + timedelta(days=1)
    return [(start_dt + timedelta(days=i)).isoformat() for i in range(days)]