import { useMemo } from 'react'
import { type Match } from '../types/match'
import { type MovementRow } from '../types/movementRow'
import { type PostMatchSummary } from '../types/postMatchSummary'
import { Icon } from './Icon'

type PostMatchCardProps = {
  result: PostMatchSummary | null
  selectedMatch?: Match | null
  movementRows?: MovementRow[]
}

function parseScore(score: string | null | undefined): { homeGoals: number; awayGoals: number } | null {
  if (!score) return null
  const match = score.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!match) return null
  return {
    homeGoals: Number(match[1]),
    awayGoals: Number(match[2]),
  }
}

export function PostMatchCard({
  result,
  selectedMatch,
  movementRows = [],
}: PostMatchCardProps) {
  const parsedScore = useMemo(() => parseScore(result?.score), [result?.score])

  const winnerRole = useMemo<'home' | 'draw' | 'away' | null>(() => {
    if (!parsedScore) return null
    if (parsedScore.homeGoals > parsedScore.awayGoals) return 'home'
    if (parsedScore.awayGoals > parsedScore.homeGoals) return 'away'
    return 'draw'
  }, [parsedScore])

  const outcomeRows = useMemo(() => {
    if (result && Array.isArray(result.outcomes) && result.outcomes.length > 0) {
      return result.outcomes.map((item, idx) => {
        const lower = item.label.toLowerCase()
        const role: 'home' | 'draw' | 'away' | null =
          lower.includes('home') || (selectedMatch && item.label === selectedMatch.home_team)
            ? 'home'
            : lower.includes('away') || (selectedMatch && item.label === selectedMatch.away_team)
              ? 'away'
              : lower.includes('draw') || lower === 'x'
                ? 'draw'
                : idx === 0
                  ? 'home'
                  : idx === 1
                    ? 'draw'
                    : 'away'

        const isWinner = typeof item.won === 'boolean' ? item.won : role !== null && role === winnerRole
        return {
          label: item.label,
          odds: item.odds,
          probability: item.probability,
          won: isWinner,
        }
      })
    }

    if (!selectedMatch && movementRows.length === 0) return []

    const roles: Array<{ role: 'home' | 'draw' | 'away'; label: string }> = [
      { role: 'home', label: selectedMatch?.home_team ?? 'Home' },
      { role: 'draw', label: 'Draw' },
      { role: 'away', label: selectedMatch?.away_team ?? 'Away' },
    ]

    return roles
      .map(({ role, label }) => {
        const matchingRows = movementRows.filter((r) => r.outcome_role === role)
        if (matchingRows.length === 0) return null

        const avgLatestOdds =
          matchingRows.reduce((acc, r) => acc + r.latest_odds, 0) / matchingRows.length
        const avgLatestProb =
          matchingRows.reduce((acc, r) => acc + r.latest_prob, 0) / matchingRows.length

        return {
          label,
          odds: avgLatestOdds > 0 ? avgLatestOdds.toFixed(2) : '—',
          probability: avgLatestProb > 0 ? `${avgLatestProb.toFixed(1)}%` : '—',
          won: winnerRole !== null && role === winnerRole,
        }
      })
      .filter((x): x is { label: string; odds: string; probability: string; won: boolean } => x !== null)
  }, [movementRows, result, selectedMatch, winnerRole])

  if (!selectedMatch && !result) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-xs text-slate-400">
        Select a fixture to inspect post-match result.
      </section>
    )
  }

  const isCompleted = Boolean(result && (result.score || result.status === 'finished'))

  const homeName = result?.home ?? selectedMatch?.home_team ?? 'Home'
  const awayName = result?.away ?? selectedMatch?.away_team ?? 'Away'
  const homeCode = result?.homeCode ?? homeName.slice(0, 3).toUpperCase()
  const awayCode = result?.awayCode ?? awayName.slice(0, 3).toUpperCase()
  const dateLabel = result?.date || (selectedMatch?.commence_time_utc?.slice(0, 10) ?? '')
  const tournamentLabel = result?.tournament || (selectedMatch?.sport_key ?? '')

  const headline =
    result?.headline ||
    (isCompleted
      ? winnerRole === 'home'
        ? `${homeName} won at full time`
        : winnerRole === 'away'
          ? `${awayName} won at full time`
          : winnerRole === 'draw'
            ? 'Match ended in a draw'
            : 'Full-time result'
      : 'Awaiting full-time result')

  const description =
    result?.description ||
    (isCompleted
      ? `${homeName} vs ${awayName} finished ${result?.score ?? ''}.`
      : `No completed result recorded yet for ${homeName} vs ${awayName}.`)

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold">Post-match result</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">Selected fixture outcome</p>
        </div>
        {isCompleted ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
            <Icon name="check" className="h-3 w-3" /> Full time
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Pending / Prematch
          </span>
        )}
      </div>

      <div className="p-5">
        <div className="mb-5 flex items-center justify-center gap-5">
          <div className="flex-1 text-right">
            <div className="text-[10px] font-bold text-slate-400">{homeCode}</div>
            <div className={`mt-1 text-sm font-bold ${winnerRole === 'home' ? 'text-emerald-700' : ''}`}>
              {homeName}
            </div>
          </div>
          <div className="rounded-xl bg-slate-950 px-5 py-3 font-mono text-2xl font-bold tracking-wider text-white">
            {result?.score ?? '— : —'}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-bold text-slate-400">{awayCode}</div>
            <div className={`mt-1 text-sm font-bold ${winnerRole === 'away' ? 'text-emerald-700' : ''}`}>
              {awayName}
            </div>
          </div>
        </div>

        {(dateLabel || tournamentLabel) && (
          <div className="mb-5 flex justify-center">
            <span className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-500">
              {[dateLabel, tournamentLabel].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}

        <div
          className={`rounded-lg border p-4 ${
            isCompleted
              ? 'border-emerald-100 bg-emerald-50/70'
              : 'border-slate-200/80 bg-slate-50/70'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                isCompleted
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200/80 text-slate-600'
              }`}
            >
              <Icon name="trend" className="h-3.5 w-3.5" />
            </div>
            <div>
              <p
                className={`text-[10px] font-bold uppercase tracking-[0.08em] ${
                  isCompleted ? 'text-emerald-700' : 'text-slate-600'
                }`}
              >
                {headline}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
            </div>
          </div>
        </div>

        {outcomeRows.length > 0 && (
          <div className="mt-5">
            <div className="mb-2.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.07em] text-slate-400">
              <span>Pre-match consensus</span>
              <span>Actual</span>
            </div>

            {outcomeRows.map((item) => (
              <div
                key={item.label}
                className={`mb-2 flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                  item.won
                    ? 'border-emerald-300 bg-emerald-50/80'
                    : 'border-slate-100 bg-white'
                }`}
              >
                <span
                  className={`min-w-[64px] truncate text-[11px] font-bold ${
                    item.won ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  {item.label}
                </span>
                <span className="font-mono text-xs font-bold tabular-nums text-slate-800">
                  {item.odds}
                </span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
                  {item.probability}
                </span>
                {item.won ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Icon name="check" className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="h-5 w-5" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}