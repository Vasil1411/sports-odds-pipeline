import { type OutcomeRole } from './outcome'

export interface Match {
  event_id: string
  sport_key: string
  commence_time_utc: string
  event_date: string
  home_team: string
  away_team: string
  outcome_name: string
  outcome_role: OutcomeRole
  bookmaker_count: number
  avg_odds: number
  min_odds: number
  max_odds: number
  odds_spread: number
  avg_implied_prob: number
  extracted_at_utc?: string | null
}