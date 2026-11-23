export type OutcomeRole = 'home' | 'draw' | 'away' | 'other'

export interface Outcome {
  role: OutcomeRole
  label: 'Home' | 'Draw' | 'Away' | string
  odds: number
  spread: string
  books: number
  probability: number
}