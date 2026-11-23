select
    event_id,
    sport_key,
    commence_time_utc,
    event_date,
    home_team,
    away_team,
    outcome_name,
    outcome_role,
    count(distinct bookmaker_key) as bookmaker_count,
    round(avg(odds_decimal), 3) as avg_odds,
    round(min(odds_decimal), 3) as min_odds,
    round(max(odds_decimal), 3) as max_odds,
    round(max(odds_decimal) - min(odds_decimal), 3) as odds_spread,
    round(avg(implied_probability), 4) as avg_implied_prob
from {{ ref('stg_odds') }}
group by
    event_id,
    sport_key,
    commence_time_utc,
    event_date,
    home_team,
    away_team,
    outcome_name,
    outcome_role