import { type Match } from '../types/match'
import { type MovementRow } from '../types/movementRow'
import { type TrendPoint } from '../types/trendPoint'

function OddsChart({ trend, mode }: { trend: TrendPoint[]; mode: 'odds' | 'probability' }) {
  if (trend.length === 0) {
    return <div className="py-16 text-center text-xs text-slate-400">No historical snapshots available for this fixture.</div>
  }

  const width = 800
  const height = 250
  const top = 18
  const bottom = 205
  const left = 42
  const right = 775
  const lastIdx = trend.length - 1

  const series = [
    { key: 'home', label: 'Home', color: '#059669' },
    { key: 'draw', label: 'Draw', color: '#64748b' },
    { key: 'away', label: 'Away', color: '#2563eb' },
  ] as const

  const values = trend.flatMap((point) => series.map((s) => (mode === 'odds' ? point[s.key] : 100 / point[s.key])))
  const min = Math.floor(Math.min(...values) * 0.9 * 10) / 10
  const max = Math.ceil(Math.max(...values) * 1.08 * 10) / 10
  const x = (index: number) => (lastIdx === 0 ? (left + right) / 2 : left + (index * (right - left)) / lastIdx)
  const y = (value: number) => (max === min ? (top + bottom) / 2 : bottom - ((value - min) / (max - min)) * (bottom - top))
  const ticks = [0, 1, 2, 3, 4].map((i) => min + ((max - min) * i) / 4)

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[680px]">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} y1={y(tick)} x2={right} y2={y(tick)} stroke="#e8edf3" strokeDasharray="3 4" />
            <text x={left - 9} y={y(tick) + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="ui-monospace, monospace">
              {mode === 'odds' ? tick.toFixed(1) : `${tick.toFixed(0)}%`}
            </text>
          </g>
        ))}

        <line x1={x(lastIdx)} y1={top} x2={x(lastIdx)} y2={bottom} stroke="#cbd5e1" strokeDasharray="4 4" />

        {series.map((item) => {
          const points = trend.map((point, index) => `${x(index)},${y(mode === 'odds' ? point[item.key] : 100 / point[item.key])}`).join(' ')
          return (
            <g key={item.key}>
              <polyline points={points} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {trend.map((point, index) => {
                const value = mode === 'odds' ? point[item.key] : 100 / point[item.key]
                return <circle key={index} cx={x(index)} cy={y(value)} r={index === lastIdx ? 4.5 : 3} fill="white" stroke={item.color} strokeWidth="2" />
              })}
            </g>
          )
        })}

        {trend.map((point, index) => (
          <text
            key={`${point.time}-${index}`}
            x={x(index)}
            y="231"
            textAnchor={index === 0 ? 'start' : index === lastIdx ? 'end' : 'middle'}
            fill={index === lastIdx ? '#475569' : '#94a3b8'}
            fontSize="9.5"
            fontWeight={index === lastIdx ? '600' : '400'}
          >
            {point.time.replace(' · ', ' ')}
          </text>
        ))}
      </svg>
    </div>
  )
}

type LineMovementCardProps = {
  match: Match | null
  trend: TrendPoint[]
  movementRows: MovementRow[]
  chartMode: 'odds' | 'probability'
  onChartModeChange: (mode: 'odds' | 'probability') => void
}

export function LineMovementCard({ match, trend, movementRows, chartMode, onChartModeChange }: LineMovementCardProps) {
  if (!match) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-xs text-slate-400">
        Select a fixture to inspect odds movement.
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-emerald-700">
              {match.shortTournament}
            </span>
            <span className="text-[10px] text-slate-400">
              {match.date} · {match.time} UTC
            </span>
          </div>
          <h3 className="text-sm font-bold">
            {match.home} <span className="mx-1 font-normal text-slate-300">vs</span> {match.away}
          </h3>
        </div>

        <div className="flex rounded-lg bg-slate-100 p-1">
          {(['odds', 'probability'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChartModeChange(mode)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-bold capitalize transition ${
                chartMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-1 pt-4 sm:px-5">
        <div className="mb-1 flex flex-wrap gap-4 pl-1">
          {[
            ['Home', 'bg-emerald-600'],
            ['Draw', 'bg-slate-500'],
            ['Away', 'bg-blue-600'],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
              <i className={`h-2 w-2 rounded-full ${color}`} />
              {label}
            </span>
          ))}
        </div>
        <OddsChart trend={trend} mode={chartMode} />
      </div>

      <div className="border-t border-slate-100">
        <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] bg-slate-50 px-5 py-2 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">
          <span>Outcome</span>
          <span>First</span>
          <span>Latest</span>
          <span>Odds Δ</span>
          <span>Prob. Δ</span>
        </div>

        {movementRows.map((row) => (
          <div key={row.outcome} className="grid grid-cols-[1.4fr_repeat(4,1fr)] border-t border-slate-100 px-5 py-2.5 text-[11px]">
            <span className="font-bold text-slate-700">{row.outcome}</span>
            <span className="font-mono tabular-nums text-slate-500">{row.first}</span>
            <span className="font-mono font-bold tabular-nums text-slate-800">{row.latest}</span>
            <span className={`font-mono font-bold tabular-nums ${row.toneClass}`}>{row.oddsDelta}</span>
            <span className={`font-mono font-bold tabular-nums ${row.toneClass}`}>{row.probDelta}</span>
          </div>
        ))}
      </div>
    </section>
  )
}