export interface CalibrationSummaryRow {
  sport_key: string
  outcome_role: 'home' | 'draw' | 'away' | string
  first_match_date: string
  last_match_date: string
  active_match_days: number
  match_dates_list: string
  evaluated_rows: number
  unique_matches: number
  favorite_picks: number
  favorite_wins: number
  favorite_hit_rate: number | null
  avg_winning_odds: number | null
  avg_raw_implied_prob: number
  avg_norm_implied_prob: number
  actual_win_rate: number
  actual_minus_norm_prob: number
  avg_total_goals: number
  avg_goal_diff: number
  blowout_2plus_rate: number
  avg_event_odds_gap: number
}