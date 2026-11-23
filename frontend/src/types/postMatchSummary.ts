export type PostMatchSummary = {
  homeCode: string
  awayCode: string
  home: string
  away: string
  score: string
  date: string
  tournament: string
  headline: string
  description: string
  outcomes: {
    label: 'Home' | 'Draw' | 'Away'
    odds: string
    probability: string
    won: boolean
  }[]
}