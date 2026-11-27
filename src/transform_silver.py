import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

ROOT = Path(__file__).resolve().parent.parent
DEDUP_KEYS = (
    "event_id",
    "bookmaker_key",
    "market_key",
    "outcome_name",
    "extracted_at_utc",
)


def build_spark() -> SparkSession:
    return (
        SparkSession.builder
        .appName("SportsOddsSilverTransform")
        .master("local[*]")
        .config("spark.sql.session.timeZone", "UTC")
        .getOrCreate()
    )


def collect_raw_input_files(run_date: str) -> list[Path]:
    raw_dir = ROOT / "data" / "raw" / "odds" / f"date={run_date}"
    files: list[Path] = []

    main_file = raw_dir / "odds.json"
    if main_file.exists():
        files.append(main_file)

    snap_dir = raw_dir / "snapshots"
    if snap_dir.exists():
        files.extend(sorted(snap_dir.glob("*.json")))

    return files


def load_existing_partition_records(part_file: Path) -> dict[tuple, dict]:
    """Зарежда вече съществуващи редове в партицията, за да не губим история при ъпдейт."""
    records_by_key: dict[tuple, dict] = {}
    if not part_file.exists():
        return records_by_key

    for line in part_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        key = tuple(rec.get(k) for k in DEDUP_KEYS)
        records_by_key[key] = rec

    return records_by_key


def _parse_utc_dt(dt_val) -> datetime | None:
    if dt_val is None:
        return None
    if isinstance(dt_val, str):
        parsed = datetime.fromisoformat(dt_val.replace("Z", "+00:00"))
    elif isinstance(dt_val, datetime):
        parsed = dt_val
    else:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def write_silver_jsonl_partitioned(flat_df, output_path: Path) -> int:
    # Групираме новите редове по event_date и ги обединяваме със съществуващите
    # в съответната партиция, като пазим само пре-мач снимки (extracted_at_utc < commence_time).
    new_by_partition: dict[str, dict[tuple, dict]] = {}
    new_rows_seen = 0
    skipped_live_rows = 0

    for row in flat_df.toLocalIterator():
        commence_dt = _parse_utc_dt(row["commence_time"])
        extracted_dt = _parse_utc_dt(row["extracted_at_utc"])

        # Не допускаме коефициенти, изтеглени след или точно в момента на началото на мача
        if commence_dt and extracted_dt and extracted_dt >= commence_dt:
            skipped_live_rows += 1
            continue

        new_rows_seen += 1
        event_date_str = commence_dt.date().isoformat() if commence_dt else "unknown"

        record = {
            "event_id": row["event_id"],
            "sport_key": row["sport_key"],
            "commence_time": commence_dt.isoformat() if commence_dt else None,
            "event_date": event_date_str,
            "home_team": row["home_team"],
            "away_team": row["away_team"],
            "bookmaker_key": row["bookmaker_key"],
            "bookmaker_title": row["bookmaker_title"],
            "market_key": row["market_key"],
            "outcome_name": row["outcome_name"],
            "odds_decimal": float(row["odds_decimal"]) if row["odds_decimal"] is not None else None,
            "extracted_at_utc": extracted_dt.isoformat() if extracted_dt else None,
            "outcome_role": row["outcome_role"],
            "implied_probability": float(row["implied_probability"]) if row["implied_probability"] is not None else None,
        }
        key = tuple(record.get(k) for k in DEDUP_KEYS)
        new_by_partition.setdefault(event_date_str, {})[key] = record

    total_partition_rows = 0
    for event_date_str, incoming_records in sorted(new_by_partition.items()):
        part_dir = output_path / f"event_date={event_date_str}"
        part_dir.mkdir(parents=True, exist_ok=True)
        part_file = part_dir / "part-000.jsonl"

        merged_records = load_existing_partition_records(part_file)
        for key, rec in incoming_records.items():
            merged_records[key] = rec

        sorted_records = sorted(
            merged_records.values(),
            key=lambda r: (
                r.get("commence_time") or "",
                r.get("event_id") or "",
                r.get("bookmaker_key") or "",
                r.get("outcome_role") or "",
                r.get("extracted_at_utc") or "",
            ),
        )
        lines = [json.dumps(rec, ensure_ascii=False) for rec in sorted_records]
        part_file.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        total_partition_rows += len(sorted_records)

    print(
        f"Обработени пре-мач редове от текущия batch: {new_rows_seen} "
        f"(пропуснати след начало на мач: {skipped_live_rows})"
    )
    return total_partition_rows


def transform_odds_to_silver(run_date: str) -> None:
    input_files = collect_raw_input_files(run_date)
    if not input_files:
        raise FileNotFoundError(
            f"Не са намерени сурови файлове за дата {run_date} в {ROOT / 'data' / 'raw' / 'odds' / f'date={run_date}'}"
        )

    output_path = ROOT / "data" / "silver" / "odds"
    output_path.mkdir(parents=True, exist_ok=True)

    spark = build_spark()
    try:
        raw_df = spark.read.option("multiLine", "true").json([str(p) for p in input_files])

        events_df = (
            raw_df.withColumn("extracted_at_utc", F.col("extracted_at_utc"))
            .withColumn("event", F.explode("events"))
            .select(
                "extracted_at_utc",
                F.col("event.id").alias("event_id"),
                F.col("event.sport_key").alias("sport_key"),
                F.col("event.commence_time").alias("commence_time"),
                F.col("event.home_team").alias("home_team"),
                F.col("event.away_team").alias("away_team"),
                F.explode("event.bookmakers").alias("bookmaker"),
            )
        )

        flat_df = (
            events_df.withColumn("market", F.explode("bookmaker.markets"))
            .select(
                "event_id",
                "sport_key",
                "commence_time",
                "home_team",
                "away_team",
                F.col("bookmaker.key").alias("bookmaker_key"),
                F.col("bookmaker.title").alias("bookmaker_title"),
                F.col("market.key").alias("market_key"),
                F.explode("market.outcomes").alias("outcome"),
                "extracted_at_utc",
            )
            .filter(F.col("market_key") == "h2h")
            .select(
                "event_id",
                "sport_key",
                "commence_time",
                "home_team",
                "away_team",
                "bookmaker_key",
                "bookmaker_title",
                "market_key",
                F.col("outcome.name").alias("outcome_name"),
                F.col("outcome.price").cast("double").alias("odds_decimal"),
                "extracted_at_utc",
            )
            .filter(F.col("odds_decimal") > 1.0)
            .withColumn(
                "outcome_role",
                F.when(F.col("outcome_name") == F.col("home_team"), F.lit("home"))
                .when(F.col("outcome_name") == F.col("away_team"), F.lit("away"))
                .when(F.col("outcome_name") == F.col("Draw"), F.lit("draw"))
                .otherwise(F.lit("other")),
            )
            .withColumn(
                "implied_probability",
                F.round(F.lit(1.0) / F.col("odds_decimal"), 4),
            )
            .dropDuplicates(list(DEDUP_KEYS))
        )

        row_count = write_silver_jsonl_partitioned(flat_df, output_path)
        print(f"Общо редове в засегнатите Silver партиции: {row_count}")
        print(f"Успешно записано в Silver слоя: {output_path}")
    finally:
        spark.stop()


if __name__ == "__main__":
    default_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    parser = argparse.ArgumentParser(description="Transform raw odds JSON & snapshots to Silver layer.")
    parser.add_argument(
        "--date",
        default=default_date,
        help="Дата в формат YYYY-MM-DD (по подразбиране днешната UTC дата)",
    )
    args = parser.parse_args()
    transform_odds_to_silver(args.date)