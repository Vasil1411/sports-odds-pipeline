export type PostMatchOutcomeLabel = 'Home' | 'Draw' | 'Away'

export interface PostMatchOutcome {
  label: PostMatchOutcomeLabel
  outcomeName?: string
  odds: number | string
  probability: number | string
  won: boolean
}

export type PostMatchStatus = 'pending_post_match_module' | 'scheduled' | 'finished'

export interface PostMatchSummary {
  eventId?: string
  status?: PostMatchStatus
  homeCode: string
  awayCode: string
  home: string
  away: string
  score: string | null
  date: string
  commenceTimeUtc?: string
  tournament: string
  headline: string
  description: string
  outcomes: PostMatchOutcome[]
}