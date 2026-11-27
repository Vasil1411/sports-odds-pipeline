import { type Match } from '../types/match'
import { type MovementRow } from '../types/movementRow'
import { type OutcomeRole } from '../types/outcome'
import { type PostMatchSummary } from '../types/postMatchSummary'
import { type TrendPoint } from '../types/trendPoint'
import { type CalibrationSummaryRow } from '../types/calibrationSummary'

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

export type DashboardPayload = {
  matches: Match[]
  tournaments: string[]
  lastSyncUtc: string | null
  postMatch: PostMatchSummary | null
  postMatchList: PostMatchSummary[]
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

function cleanSportKey(sportKey?: string): string | undefined {
  if (!sportKey || sportKey === 'All Tournaments') {
    return undefined
  }
  return sportKey
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

function parsePostMatchStatus(value: unknown): PostMatchSummary['status'] {
  const s = String(value ?? 'finished').toLowerCase()
  if (s === 'finished' || s === 'live' || s === 'scheduled' || s === 'postponed') {
    return s as PostMatchSummary['status']
  }
  return 'finished'
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

function normalizeTrendPoint(row: Record<string, unknown>): TrendPoint {
  return {
    event_id: String(row.event_id ?? ''),
    sport_key: String(row.sport_key ?? ''),
    commence_time_utc: String(row.commence_time_utc ?? ''),
    event_date: row.event_date ? String(row.event_date) : undefined,
    home_team: String(row.home_team ?? ''),
    away_team: String(row.away_team ?? ''),
    bookmaker_key: String(row.bookmaker_key ?? ''),
    bookmaker_title: String(row.bookmaker_title ?? row.bookmaker_key ?? ''),
    market_key: row.market_key ? String(row.market_key) : undefined,
    outcome_name: String(row.outcome_name ?? ''),
    outcome_role: parseOutcomeRole(row.outcome_role),
    odds_decimal: Number(row.odds_decimal ?? 0),
    implied_probability: Number(row.implied_probability ?? 0),
    extracted_at_utc: String(row.extracted_at_utc ?? ''),
  }
}

function normalizeMovementRow(row: Record<string, unknown>): MovementRow {
  return {
    event_id: String(row.event_id ?? ''),
    sport_key: String(row.sport_key ?? ''),
    home_team: String(row.home_team ?? ''),
    away_team: String(row.away_team ?? ''),
    bookmaker_key: String(row.bookmaker_key ?? ''),
    outcome_role: parseOutcomeRole(row.outcome_role),
    outcome_name: String(row.outcome_name ?? ''),
    first_seen_utc: String(row.first_seen_utc ?? ''),
    last_seen_utc: String(row.last_seen_utc ?? ''),
    first_odds: Number(row.first_odds ?? 0),
    latest_odds: Number(row.latest_odds ?? 0),
    odds_diff: Number(row.odds_diff ?? 0),
    first_prob: Number(row.first_prob ?? 0),
    latest_prob: Number(row.latest_prob ?? 0),
    prob_diff_pp: Number(row.prob_diff_pp ?? 0),
  }
}

function normalizePostMatch(raw: unknown): PostMatchSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const home = String(data.home ?? data.home_team ?? '')
  const away = String(data.away ?? data.away_team ?? '')
  if (!home || !away) return null

  const homeScore = data.home_score
  const awayScore = data.away_score
  const computedScore =
    typeof data.score === 'string' && data.score
      ? data.score
      : homeScore !== undefined && awayScore !== undefined
        ? `${homeScore} - ${awayScore}`
        : null

  return {
    eventId: String(data.eventId ?? data.event_id ?? ''),
    status: parsePostMatchStatus(data.status),
    homeCode: String(data.homeCode ?? home.slice(0, 3).toUpperCase()),
    awayCode: String(data.awayCode ?? away.slice(0, 3).toUpperCase()),
    home,
    away,
    score: computedScore,
    date: String(data.date ?? String(data.commence_time_utc ?? '').slice(0, 10)),
    commenceTimeUtc: data.commenceTimeUtc ? String(data.commenceTimeUtc) : undefined,
    tournament: String(data.tournament ?? data.sport_key ?? ''),
    headline: String(data.headline ?? 'Full-time result'),
    description: String(data.description ?? `${home} vs ${away}`),
    outcomes: Array.isArray(data.outcomes) ? (data.outcomes as PostMatchSummary['outcomes']) : [],
  }
}

export async function fetchCompletedResults(
  options?: { sportKey?: string; date?: string; signal?: AbortSignal },
): Promise<PostMatchSummary[]> {
  const sportKey = cleanSportKey(options?.sportKey)
  const params = new URLSearchParams()
  if (sportKey) params.set('sport_key', sportKey)
  if (options?.date) params.set('event_date', options.date)

  const query = params.toString()
  const raw = await requestJson<{ results?: Record<string, unknown>[] }>(
    `${API_BASE}/api/results${query ? `?${query}` : ''}`,
    { signal: options?.signal },
  )

  return Array.isArray(raw.results)
    ? raw.results.map(normalizePostMatch).filter((item): item is PostMatchSummary => item !== null)
    : []
}

export async function fetchDashboardData(
  date: string,
  options?: string | { sportKey?: string; signal?: AbortSignal },
): Promise<DashboardPayload> {
  const sportKey = typeof options === 'string' ? cleanSportKey(options) : cleanSportKey(options?.sportKey)
  const signal = typeof options === 'object' ? options?.signal : undefined

  const params = new URLSearchParams()
  if (date) {
    params.set('date', date)
  }
  if (sportKey) {
    params.set('sport_key', sportKey)
  }

  const raw = await requestJson<Partial<DashboardPayload> & { matches?: Record<string, unknown>[] }>(
    `${API_BASE}/api/odds?${params.toString()}`,
    { signal },
  )

  const matches = Array.isArray(raw.matches) ? raw.matches.map(normalizeMatch) : []
  const tournaments = Array.isArray(raw.tournaments)
    ? raw.tournaments.map((t) => String(t)).filter(Boolean)
    : Array.from(new Set(matches.map((m) => m.sport_key).filter(Boolean))).sort()

  const singlePostMatch = normalizePostMatch(raw.postMatch)
  let postMatchList: PostMatchSummary[] = singlePostMatch ? [singlePostMatch] : []

  try {
    const results = await fetchCompletedResults({ sportKey, signal })
    if (results.length > 0) {
      postMatchList = results
    }
  } catch {
    // Ако /api/results не върне списък, оставаме с единичния postMatch от /api/odds
  }

  return {
    matches,
    tournaments,
    lastSyncUtc: raw.lastSyncUtc ? String(raw.lastSyncUtc) : null,
    postMatch: postMatchList[0] ?? singlePostMatch,
    postMatchList,
  }
}

export async function fetchMatchMovement(
  matchId: string | number,
  options?: { signal?: AbortSignal },
): Promise<MatchMovementPayload> {
  const encodedId = encodeURIComponent(String(matchId))
  const raw = await requestJson<{
    trend?: Record<string, unknown>[]
    movementRows?: Record<string, unknown>[]
  }>(`${API_BASE}/api/odds/${encodedId}/movement`, { signal: options?.signal })

  return {
    trend: Array.isArray(raw.trend) ? raw.trend.map(normalizeTrendPoint) : [],
    movementRows: Array.isArray(raw.movementRows) ? raw.movementRows.map(normalizeMovementRow) : [],
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
  const sportKey = cleanSportKey(options?.sportKey)
  if (sportKey) {
    params.set('sport_key', sportKey)
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
  options?: { windowMinutes?: number; sportKey?: string },
): Promise<DashboardPayload> {
  await triggerPipelineSync({
    windowMinutes: options?.windowMinutes,
    sportKey: options?.sportKey,
  })
  return fetchDashboardData(date, { sportKey: options?.sportKey })
}

export async function fetchCalibrationSummary(
  options: { sportKey?: string; signal?: AbortSignal } = {},
): Promise<CalibrationSummaryRow[]> {
  const sportKey = cleanSportKey(options.sportKey)
  const params = new URLSearchParams()
  if (sportKey) params.set('sport_key', sportKey)
  const qs = params.toString()

  const raw = await requestJson<{ summary?: CalibrationSummaryRow[] }>(
    `${API_BASE}/api/calibration/summary${qs ? `?${qs}` : ''}`,
    { signal: options.signal },
  )

  return Array.isArray(raw.summary) ? raw.summary : []
}