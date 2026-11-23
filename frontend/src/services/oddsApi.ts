import { type Match } from '../types/match'
import { type PostMatchSummary } from '../types/postMatchSummary'
import { type TrendPoint } from '../types/trendPoint'
import { type MovementRow } from '../types/movementRow'

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

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

let activeSyncPromise: Promise<void> | null = null

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errBody = await res.json()
      detail = typeof errBody?.detail === 'string' ? ` — ${errBody.detail}` : ''
    } catch {
      // Игнорираме ако тялото не е JSON
    }
    throw new Error(`API грешка (${res.status})${detail}`)
  }

  return (await res.json()) as T
}

export async function fetchDashboardData(
  date: string,
  options?: { sportKey?: string; signal?: AbortSignal }
): Promise<DashboardPayload> {
  const params = new URLSearchParams({ date })
  if (options?.sportKey) {
    params.set('sport_key', options.sportKey)
  }

  return requestJson<DashboardPayload>(`${API_BASE}/api/odds?${params.toString()}`, {
    signal: options?.signal,
  })
}

export async function fetchMatchMovement(
  matchId: string | number,
  options?: { signal?: AbortSignal }
): Promise<MatchMovementPayload> {
  const encodedId = encodeURIComponent(String(matchId))
  return requestJson<MatchMovementPayload>(`${API_BASE}/api/odds/${encodedId}/movement`, {
    signal: options?.signal,
  })
}

export async function triggerPipelineSync(options?: {
  windowMinutes?: number
  sportKey?: string
  dryRun?: boolean
}): Promise<void> {
  if (activeSyncPromise) {
    return activeSyncPromise
  }

  const params = new URLSearchParams()
  if (typeof options?.windowMinutes === 'number') {
    params.set('window_minutes', String(options.windowMinutes))
  }
  if (options?.sportKey) {
    params.set('sport_key', options.sportKey)
  }
  if (typeof options?.dryRun === 'boolean') {
    params.set('dry_run', String(options.dryRun))
  }

  const query = params.toString()
  const url = `${API_BASE}/api/sync${query ? `?${query}` : ''}`

  activeSyncPromise = (async () => {
    try {
      await requestJson<Record<string, unknown>>(url, { method: 'POST' })
    } finally {
      activeSyncPromise = null
    }
  })()

  return activeSyncPromise
}

export async function syncAndRefreshDashboard(
  date: string,
  options?: { windowMinutes?: number; sportKey?: string }
): Promise<DashboardPayload> {
  await triggerPipelineSync({
    windowMinutes: options?.windowMinutes,
    sportKey: options?.sportKey,
  })
  return fetchDashboardData(date, { sportKey: options?.sportKey })
}