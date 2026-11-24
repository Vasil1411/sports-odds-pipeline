import { useMemo } from 'react'
import { type Match } from '../types/match'
import { type OutcomeRole } from '../types/outcome'

type GroupedMatch = {
  event_id: string
  sport_key: string
  commence_time_utc: string
  event_date: string
  home_team: string
  away_team: string
  bookmaker_count: number
  byRole: Partial<Record<'home' | 'draw' | 'away', Match>>
}

function formatUtcTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function formatUtcShortDate(isoOrDate: string): string {
  const d = new Date(isoOrDate)
  if (!Number.isNaN(d.getTime())) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]}`
  }
  return isoOrDate.slice(0, 10)
}

function OutcomeCell({
  label,
  row,
}: {
  label: 'Home' | 'Draw' | 'Away'
  row?: Match
}) {
  if (!row) {
    return (
      <div className="min-w-[148px] rounded-lg border border-slate-200/60 bg-slate-50/50 px-3 py-2.5 text-[11px] text-slate-400">
        {label}: —
      </div>
    )
  }

  const probPct =
    row.avg_implied_prob <= 1
      ? Math.round(row.avg_implied_prob * 100)
      : Math.round(row.avg_implied_prob)

  return (
    <div className="min-w-[148px] rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 transition group-hover:border-slate-300">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
          {label}
        </span>
        <span className="font-mono text-[15px] font-bold tabular-nums text-slate-900">
          {row.avg_odds.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px] tabular-nums text-slate-400">
        <span>
          {row.min_odds.toFixed(2)}–{row.max_odds.toFixed(2)}
        </span>
        <span className="font-semibold text-slate-600">{probPct}%</span>
      </div>
      <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-slate-400"
          style={{ width: `${Math.min(100, Math.max(0, probPct))}%` }}
        />
      </div>
    </div>
  )
}

type MatchesTableProps = {
  matches: Match[]
  selectedId: string | null
  onSelectMatch: (id: string) => void
  loading: boolean
}

export function MatchesTable({ matches, selectedId, onSelectMatch, loading }: MatchesTableProps) {
  const groupedMatches = useMemo<GroupedMatch[]>(() => {
    const map = new Map<string, GroupedMatch>()

    for (const row of matches) {
      if (!row.event_id) continue
      if (!map.has(row.event_id)) {
        map.set(row.event_id, {
          event_id: row.event_id,
          sport_key: row.sport_key,
          commence_time_utc: row.commence_time_utc,
          event_date: row.event_date,
          home_team: row.home_team,
          away_team: row.away_team,
          bookmaker_count: row.bookmaker_count,
          byRole: {},
        })
      }

      const item = map.get(row.event_id)!
      item.bookmaker_count = Math.max(item.bookmaker_count, row.bookmaker_count)
      const role: OutcomeRole = row.outcome_role
      if (role === 'home' || role === 'draw' || role === 'away') {
        item.byRole[role] = row
      }
    }

    return Array.from(map.values())
  }, [matches])

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Matches consensus</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {groupedMatches.length} fixtures · Select a match to inspect movement
          </p>
        </div>
        <div className="hidden items-center gap-4 text-[10px] font-semibold text-slate-400 md:flex">
          <span>ODDS RANGE</span>
          <span>IMPLIED PROB.</span>
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-12 text-center text-xs text-slate-400">Loading odds from pipeline...</div>
      ) : groupedMatches.length === 0 ? (
        <div className="px-5 py-12 text-center text-xs text-slate-400">
          No fixtures found for the selected date and tournament.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1020px]">
            <div className="grid grid-cols-[2.1fr_repeat(3,1.25fr)_90px] gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-slate-400">
              <span>Fixture / kickoff</span>
              <span>Home</span>
              <span>Draw</span>
              <span>Away</span>
              <span className="text-right">Books</span>
            </div>

            {groupedMatches.map((match) => (
              <button
                key={match.event_id}
                onClick={() => onSelectMatch(match.event_id)}
                className={`group grid w-full grid-cols-[2.1fr_repeat(3,1.25fr)_90px] items-center gap-3 border-b border-slate-100 px-5 py-3 text-left transition last:border-0 hover:bg-slate-50 ${
                  selectedId === match.event_id ? 'bg-emerald-50/40 shadow-[inset_3px_0_0_#10b981]' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="w-12 shrink-0 text-center">
                    <div className="font-mono text-sm font-bold tabular-nums text-slate-800">
                      {formatUtcTime(match.commence_time_utc)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {formatUtcShortDate(match.commence_time_utc || match.event_date)} UTC
                    </div>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-slate-900">
                      {match.home_team} <span className="mx-1 font-normal text-slate-300">vs</span>{' '}
                      {match.away_team}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="truncate text-[10px] text-slate-400">{match.sport_key}</span>
                    </div>
                  </div>
                </div>

                <OutcomeCell label="Home" row={match.byRole.home} />
                <OutcomeCell label="Draw" row={match.byRole.draw} />
                <OutcomeCell label="Away" row={match.byRole.away} />

                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-slate-700">
                    {match.bookmaker_count}
                  </div>
                  <div className="text-[10px] text-slate-400">sources</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}