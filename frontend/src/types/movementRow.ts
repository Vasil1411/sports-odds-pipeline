import { type OutcomeRole } from './outcome'

export interface MovementRow {
  event_id: string
  sport_key: string
  home_team: string
  away_team: string
  bookmaker_key: string
  outcome_role: OutcomeRole
  outcome_name: string
  first_seen_utc: string
  last_seen_utc: string
  first_odds: number
  latest_odds: number
  odds_diff: number
  first_prob: number
  latest_prob: number
  prob_diff_pp: number
}