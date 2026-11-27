import { type CalibrationSummaryRow } from '../types/calibrationSummary'

interface Props {
  rows: CalibrationSummaryRow[]
}

const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`

const signedPp = (v: number | null | undefined) => {
  if (v == null) return '—'
  const pp = v * 100
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp`
}

export function CalibrationSummaryCard({ rows }: Props) {
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            H2H Calibration &amp; Scoring Summary (by League &amp; Role)
          </h2>
          <p className="text-xs text-slate-500">
            Consensus accuracy, implied vs. actual win rate, goals &amp; blowouts across completed matches
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-400">
          No calibration summary rows available for the current filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">League</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Match Dates</th>
                <th className="py-2 pr-3 text-right">Matches</th>
                <th className="py-2 pr-3 text-right">Fav Hit</th>
                <th className="py-2 pr-3 text-right">Win Odds</th>
                <th className="py-2 pr-3 text-right">Norm Prob</th>
                <th className="py-2 pr-3 text-right">Actual Win</th>
                <th className="py-2 pr-3 text-right">Diff</th>
                <th className="py-2 pr-3 text-right">Avg Goals</th>
                <th className="py-2 text-right">Blowout 2+</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.sport_key}-${r.outcome_role}`} className="hover:bg-slate-50">
                  <td className="py-2 pr-3 font-medium text-slate-800">{r.sport_key}</td>
                  <td className="py-2 pr-3 uppercase text-slate-600">{r.outcome_role}</td>
                  <td className="py-2 pr-3 text-slate-500" title={r.match_dates_list}>
                    {r.first_match_date === r.last_match_date
                      ? r.first_match_date
                      : `${r.first_match_date} → ${r.last_match_date}`}{' '}
                    ({r.active_match_days}d)
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{r.unique_matches}</td>
                  <td className="py-2 pr-3 text-right font-mono">{pct(r.favorite_hit_rate)}</td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {r.avg_winning_odds != null ? r.avg_winning_odds.toFixed(2) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{pct(r.avg_norm_implied_prob)}</td>
                  <td className="py-2 pr-3 text-right font-mono font-semibold text-slate-900">
                    {pct(r.actual_win_rate)}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right font-mono font-semibold ${
                      r.actual_minus_norm_prob >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {signedPp(r.actual_minus_norm_prob)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{r.avg_total_goals.toFixed(2)}</td>
                  <td className="py-2 text-right font-mono">{pct(r.blowout_2plus_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}