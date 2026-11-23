import { type Match } from '../types/match'
import { type Outcome } from '../types/outcome'

function OutcomeCell({ outcome }: { outcome: Outcome }) {
  return (
    <div className="min-w-[148px] rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 transition group-hover:border-slate-300">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{outcome.label}</span>
        <span className="font-mono text-[15px] font-bold tabular-nums text-slate-900">{outcome.odds.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px] tabular-nums text-slate-400">
        <span>{outcome.spread}</span>
        <span className="font-semibold text-slate-600">{outcome.probability}%</span>
      </div>
      <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-400" style={{ width: `${outcome.probability}%` }} />
      </div>
    </div>
  )
}

type MatchesTableProps = {
  matches: Match[]
  selectedId: string | number | null
  onSelectMatch: (id: string | number) => void
  loading: boolean
}

export function MatchesTable({ matches, selectedId, onSelectMatch, loading }: MatchesTableProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Matches consensus</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">{matches.length} fixtures · Select a match to inspect movement</p>
        </div>
        <div className="hidden items-center gap-4 text-[10px] font-semibold text-slate-400 md:flex">
          <span>ODDS RANGE</span>
          <span>IMPLIED PROB.</span>
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-12 text-center text-xs text-slate-400">Loading odds from pipeline...</div>
      ) : matches.length === 0 ? (
        <div className="px-5 py-12 text-center text-xs text-slate-400">No fixtures found for the selected date and tournament.</div>
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

            {matches.map((match) => (
              <button
                key={match.id}
                onClick={() => onSelectMatch(match.id)}
                className={`group grid w-full grid-cols-[2.1fr_repeat(3,1.25fr)_90px] items-center gap-3 border-b border-slate-100 px-5 py-3 text-left transition last:border-0 hover:bg-slate-50 ${
                  selectedId === match.id ? 'bg-emerald-50/40 shadow-[inset_3px_0_0_#10b981]' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="w-12 shrink-0 text-center">
                    <div className="font-mono text-sm font-bold tabular-nums text-slate-800">{match.time}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{match.date} UTC</div>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-slate-900">
                      {match.home} <span className="mx-1 font-normal text-slate-300">vs</span> {match.away}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-slate-500">
                        {match.shortTournament}
                      </span>
                      <span className="truncate text-[10px] text-slate-400">{match.tournament}</span>
                    </div>
                  </div>
                </div>

                {match.outcomes.map((outcome) => (
                  <OutcomeCell key={outcome.label} outcome={outcome} />
                ))}

                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-slate-700">{match.outcomes[0]?.books ?? 0}</div>
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