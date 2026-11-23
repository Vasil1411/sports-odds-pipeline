import { type OutcomeRole } from './outcome'

export interface TrendPoint {
  event_id: string
  sport_key: string
  commence_time_utc: string
  event_date?: string
  home_team: string
  away_team: string
  bookmaker_key: string
  bookmaker_title: string
  market_key?: string
  outcome_name: string
  outcome_role: OutcomeRole
  odds_decimal: number
  implied_probability: number
  extracted_at_utc: string
}