import {type Match} from '../types/match'
import {type PostMatchSummary} from '../types/postMatchSummary'
import {type TrendPoint} from '../types/trendPoint'
import {type MovementRow} from '../types/movementRow'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type DashboardPayload = {
  matches: Match[]
  tournaments: string[]
  lastSyncUtc: string | null
  postMatch: PostMatchSummary | null
}

export type MatchMovementPayload = {
  trend: TrendPoint[]
  movementRows: MovementRow[]
}

export async function fetchDashboardData(date: string): Promise<DashboardPayload> {
  const res = await fetch(`${API_BASE}/api/odds?date=${encodeURIComponent(date)}`)
  if (!res.ok) throw new Error(`API грешка (${res.status})`)
  return res.json()
}

export async function fetchMatchMovement(matchId: string | number): Promise<MatchMovementPayload> {
  const res = await fetch(`${API_BASE}/api/odds/${encodeURIComponent(String(matchId))}/movement`)
  if (!res.ok) throw new Error(`Грешка при зареждане на движението (${res.status})`)
  return res.json()
}

export async function triggerPipelineSync(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(`Грешка при синхронизация (${res.status})`)
}