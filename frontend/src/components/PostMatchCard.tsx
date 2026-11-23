import { type PostMatchSummary } from '../types/postMatchSummary'
import { Icon } from './Icon'

export function PostMatchCard({ result }: { result: PostMatchSummary | null }) {
  if (!result) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-xs text-slate-400">
        No completed fixtures available yet.
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold">Post-match result</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">Latest completed fixture</p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
          <Icon name="check" className="h-3 w-3" /> Full time
        </span>
      </div>

      <div className="p-5">
        <div className="mb-5 flex items-center justify-center gap-5">
          <div className="flex-1 text-right">
            <div className="text-[10px] font-bold text-slate-400">{result.homeCode}</div>
            <div className="mt-1 text-sm font-bold">{result.home}</div>
          </div>
          <div className="rounded-xl bg-slate-950 px-5 py-3 font-mono text-2xl font-bold tracking-wider text-white">
            {result.score}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-bold text-slate-400">{result.awayCode}</div>
            <div className="mt-1 text-sm font-bold">{result.away}</div>
          </div>
        </div>

        <div className="mb-5 flex justify-center">
          <span className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-500">
            {result.date} · {result.tournament}
          </span>
        </div>

        <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="trend" className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">{result.headline}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{result.description}</p>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.07em] text-slate-400">
            <span>Pre-match consensus</span>
            <span>Actual</span>
          </div>

          {result.outcomes.map((item) => (
            <div
              key={item.label}
              className={`mb-2 flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                item.won ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-100'
              }`}
            >
              <span className={`w-12 text-[11px] font-bold ${item.won ? 'text-emerald-700' : 'text-slate-500'}`}>{item.label}</span>
              <span className="font-mono text-xs font-bold tabular-nums text-slate-800">{item.odds}</span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{item.probability}</span>
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
      </div>
    </section>
  )
}