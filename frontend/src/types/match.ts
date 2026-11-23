import { type Outcome } from './outcome'


export type Match = {
  id: string  
  home: string
  away: string
  homeCode: string
  awayCode: string
  time: string
  date: string
  tournament: string
  shortTournament: string
  status: 'Live' | 'Upcoming' | 'Completed'
  score?: string
  outcomes: Outcome[]
}