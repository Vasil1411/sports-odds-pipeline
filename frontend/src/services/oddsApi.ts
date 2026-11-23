import { type Match } from '../types/match'
import { type OutcomeRole } from '../types/outcome'
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

function parseOutcomeRole(value: unknown): OutcomeRole {
  const role = String(value ?? '').toLowerCase()
  if (role === 'home' || role === 'draw' || role === 'away') {
    return role
  }
  return 'other'
}

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

function normalizeMatch(row: Record<string, unknown>): Match {
  return {
    event_id: String(row.event_id ?? ''),
    sport_key: String(row.sport_key ?? ''),
    commence_time_utc: String(row.commence_time_utc ?? ''),
    event_date: String(row.event_date ?? ''),
    home_team: String(row.home_team ?? ''),
    away_team: String(row.away_team ?? ''),
    outcome_name: String(row.outcome_name ?? ''),
    outcome_role: parseOutcomeRole(row.outcome_role),
    bookmaker_count: Number(row.bookmaker_count ?? 0),
    avg_odds: Number(row.avg_odds ?? 0),
    min_odds: Number(row.min_odds ?? 0),
    max_odds: Number(row.max_odds ?? 0),
    odds_spread: Number(row.odds_spread ?? 0),
    avg_implied_prob: Number(row.avg_implied_prob ?? 0),
    extracted_at_utc: row.extracted_at_utc ? String(row.extracted_at_utc) : null,
  }
}

function normalizePostMatch(raw: unknown): PostMatchSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<PostMatchSummary>
  if (!data.home || !data.away) return null

  return {
    eventId: data.eventId,
    status: data.status ?? 'finished',
    homeCode: data.homeCode ?? data.home.slice(0, 3).toUpperCase(),
    awayCode: data.awayCode ?? data.away.slice(0, 3).toUpperCase(),
    home: data.home,
    away: data.away,
    score: data.score ?? null,
    date: data.date ?? '',
    commenceTimeUtc: data.commenceTimeUtc,
    tournament: data.tournament ?? '',
    headline: data.headline ?? '',
    description: data.description ?? '',
    outcomes: Array.isArray(data.outcomes) ? data.outcomes : [],
  }
}

export async function fetchDashboardData(
  date: string,
  options?: { sportKey?: string; signal?: AbortSignal }
): Promise<DashboardPayload> {
  const params = new URLSearchParams({ date })
  if (options?.sportKey) {
    params.set('sport_key', options.sportKey)
  }

  const raw = await requestJson<Partial<DashboardPayload> & { matches?: Record<string, unknown>[] }>(
    `${API_BASE}/api/odds?${params.toString()}`,
    { signal: options?.signal }
  )

  const matches = Array.isArray(raw.matches) ? raw.matches.map(normalizeMatch) : []
  const tournaments = Array.isArray(raw.tournaments)
    ? raw.tournaments
    : Array.from(new Set(matches.map((m) => m.sport_key).filter(Boolean))).sort()

  return {
    matches,
    tournaments,
    lastSyncUtc: raw.lastSyncUtc ?? null,
    postMatch: normalizePostMatch(raw.postMatch),
  }
}

export async function fetchMatchMovement(
  matchId: string | number,
  options?: { signal?: AbortSignal }
): Promise<MatchMovementPayload> {
  const encodedId = encodeURIComponent(String(matchId))
  const raw = await requestJson<Partial<MatchMovementPayload>>(
    `${API_BASE}/api/odds/${encodedId}/movement`,
    { signal: options?.signal }
  )

  return {
    trend: Array.isArray(raw.trend) ? raw.trend : [],
    movementRows: Array.isArray(raw.movementRows) ? raw.movementRows : [],
  }
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