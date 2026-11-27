with results as (
    select
        cast(event_id as varchar) as event_id,
        cast(sport_key as varchar) as sport_key,
        cast(commence_time_utc as timestamp) as commence_time_utc,
        cast(home_team as varchar) as home_team,
        cast(away_team as varchar) as away_team,
        cast(home_score as integer) as home_score,
        cast(away_score as integer) as away_score,
        (cast(home_score as integer) + cast(away_score as integer)) as total_goals,
        abs(cast(home_score as integer) - cast(away_score as integer)) as goal_diff,
        cast(winner_role as varchar) as winner_role
    from {{ source('warehouse', 'match_results') }}
    where completed = true
      and home_score is not null
      and away_score is not null
      and winner_role in ('home', 'away', 'draw')
),

odds_with_match_context as (
    select
        m.*,
        (1.0 / nullif(m.avg_odds, 0)) as raw_inv_prob,
        sum(1.0 / nullif(m.avg_odds, 0)) over (partition by m.event_id) as overround_sum,
        min(m.avg_odds) over (partition by m.event_id) as min_event_odds,
        max(m.avg_odds) over (partition by m.event_id) as max_event_odds
    from {{ ref('mart_match_consensus_odds') }} m
    where m.avg_odds > 1.0
),

odds_with_probs as (
    select
        *,
        raw_inv_prob / nullif(overround_sum, 0) as norm_implied_prob,
        case
            when avg_odds = min_event_odds then 1
            else 0
        end as is_consensus_favorite,
        case
            when avg_odds < 1.50 then '01_lt_1.50'
            when avg_odds < 2.00 then '02_1.50_to_1.99'
            when avg_odds < 3.00 then '03_2.00_to_2.99'
            when avg_odds < 5.00 then '04_3.00_to_4.99'
            else '05_gte_5.00'
        end as odds_bucket
    from odds_with_match_context
),

joined as (
    select
        o.sport_key,
        o.event_date,
        o.outcome_role,
        o.odds_bucket,
        o.is_consensus_favorite,
        o.avg_odds,
        (o.max_event_odds - o.min_event_odds) as event_odds_gap,
        o.raw_inv_prob,
        o.norm_implied_prob,
        case when o.outcome_role = r.winner_role then 1.0 else 0.0 end as is_won,
        r.total_goals,
        r.goal_diff,
        case when r.goal_diff >= 2 then 1.0 else 0.0 end as is_blowout_2plus
    from odds_with_probs o
    inner join results r
        on o.event_id = r.event_id
)

select
    sport_key,
    event_date,
    outcome_role,
    odds_bucket,
    count(*) as evaluated_rows,
    -- Консенсусен фаворит (най-нисък avg_odds в мача)
    sum(case when is_consensus_favorite = 1 then 1 else 0 end) as favorite_rows,
    sum(case when is_consensus_favorite = 1 and is_won = 1.0 then 1 else 0 end) as favorite_wins,
    round(
        sum(case when is_consensus_favorite = 1 and is_won = 1.0 then 1 else 0 end) * 1.0
        / nullif(sum(case when is_consensus_favorite = 1 then 1 else 0 end), 0),
        4
    ) as favorite_hit_rate,
    -- Среден коефициент на познатите прогнози
    round(avg(case when is_won = 1.0 then avg_odds end), 3) as avg_winning_odds,
    -- Имплицитна вероятност (сурова и нормализирана без марж) vs реална успеваемост
    round(avg(raw_inv_prob), 4) as avg_raw_implied_prob,
    round(avg(norm_implied_prob), 4) as avg_norm_implied_prob,
    round(avg(is_won), 4) as actual_win_rate,
    round(avg(is_won) - avg(norm_implied_prob), 4) as actual_minus_norm_prob,
    -- Резултатност, разгроми и връзка с предмачовите коефициенти
    round(avg(total_goals), 2) as avg_total_goals,
    round(avg(goal_diff), 2) as avg_goal_diff,
    round(avg(is_blowout_2plus), 4) as blowout_2plus_rate,
    round(avg(event_odds_gap), 3) as avg_event_odds_gap
from joined
group by
    sport_key,
    event_date,
    outcome_role,
    odds_bucket