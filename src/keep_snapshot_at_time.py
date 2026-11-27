import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _parse_utc(val) -> datetime | None:
    if not val:
        return None
    s = str(val).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Safely preview and remove specific UTC snapshots from Silver JSONL files."
    )
    parser.add_argument("--date", default=None, help="Дата на снапшота (UTC) YYYY-MM-DD, напр. 2026-11-27")
    parser.add_argument("--from-hm", default=None, help="Начален час:минута (UTC) за триене, напр. 10:42")
    parser.add_argument("--to-hm", default=None, help="Краен час:минута (UTC) за триене (включително), напр. 10:45")
    parser.add_argument("--event-date", default=None, help="По избор: партиция event_date=YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="Само показва какво ще се изтрие")
    parser.add_argument("--silver", default=str(ROOT / "data" / "silver" / "odds"))
    args = parser.parse_args()

    if not args.date and not args.from_hm:
        print("Предпазен стоп: подай поне --date или --from-hm, за да не се изтрият всички данни случайно.")
        return

    silver_root = Path(args.silver)
    from_hm = tuple(map(int, args.from_hm.split(":"))) if args.from_hm else None
    to_hm = tuple(map(int, args.to_hm.split(":"))) if args.to_hm else None

    all_ts: set[str] = set()
    to_remove_ts: set[str] = set()

    for part_file in sorted(silver_root.rglob("part-000.jsonl")):
        if args.event_date and f"event_date={args.event_date}" not in str(part_file):
            continue
        for line in part_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            raw_ts = rec.get("extracted_at_utc")
            dt = _parse_utc(raw_ts)
            if not raw_ts or dt is None:
                continue
            ts_str = str(raw_ts)
            all_ts.add(ts_str)

            match_date = (args.date is None) or (dt.strftime("%Y-%m-%d") == args.date)
            hm = (dt.hour, dt.minute)
            match_from = (from_hm is None) or (hm >= from_hm)
            match_to = (to_hm is None) or (hm <= to_hm)

            if match_date and match_from and match_to:
                to_remove_ts.add(ts_str)

    kept_ts = sorted(all_ts - to_remove_ts)
    remove_sorted = sorted(to_remove_ts)

    print(f"Общо уникални extracted_at_utc: {len(all_ts)}")
    print(f"Запазват се ({len(kept_ts)}):")
    for t in kept_ts:
        print("  KEEP  :", t)
    print(f"Ще се изтрият ({len(remove_sorted)}):")
    for t in remove_sorted:
        print("  REMOVE:", t)

    if args.dry_run:
        print("Dry run — нищо не е променено.")
        return

    removed_rows = 0
    for part_file in sorted(silver_root.rglob("part-000.jsonl")):
        if args.event_date and f"event_date={args.event_date}" not in str(part_file):
            continue
        kept_lines = []
        file_removed = 0
        for line in part_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if str(rec.get("extracted_at_utc") or "") in to_remove_ts:
                file_removed += 1
                continue
            kept_lines.append(json.dumps(rec, ensure_ascii=False))
        if file_removed > 0:
            part_file.write_text("\n".join(kept_lines) + ("\n" if kept_lines else ""), encoding="utf-8")
            removed_rows += file_removed
            print(f"Премахнати {file_removed} реда от {part_file}")

    print(f"Готово. Премахнати общо {removed_rows} реда от Silver.")
    print("След това пусни: python -m dbt.cli.main run --profiles-dir . --no-partial-parse")


if __name__ == "__main__":
    main()