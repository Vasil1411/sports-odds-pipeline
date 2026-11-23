with source_data as (
    select *
    from read_json_auto('data/silver/odds/**/*.jsonl', hive_partitioning = true)
)

select
    cast(event_id as varchar) as event_id,
    cast(sport_key as varchar) as sport_key,
    cast(commence_time as timestamp) as commence_time_utc,
    cast(event_date as date) as event_date,
    cast(home_team as varchar) as home_team,
    cast(away_team as varchar) as away_team,
    cast(bookmaker_key as varchar) as bookmaker_key,
    cast(bookmaker_title as varchar) as bookmaker_title,
    cast(market_key as varchar) as market_key,
    cast(outcome_name as varchar) as outcome_name,
    cast(outcome_role as varchar) as outcome_role,
    cast(odds_decimal as double) as odds_decimal,
    cast(implied_probability as double) as implied_probability,
    cast(extracted_at_utc as timestamp) as extracted_at_utc
from source_data
where market_key = 'h2h'
  and odds_decimal > 1.0