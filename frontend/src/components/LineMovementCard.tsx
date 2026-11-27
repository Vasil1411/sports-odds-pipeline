import { useEffect, useMemo, useState } from 'react'
import { type Match } from '../types/match'
import { type MovementRow } from '../types/movementRow'
import { type TrendPoint } from '../types/trendPoint'

type ChartBucket = {
  index: number
  ts: string
  label: string
  home: number
  draw: number
  away: number
  booksCount: number
}

type ConsensusSummaryItem = {
  role: 'home' | 'draw' | 'away'
  label: 'Home' | 'Draw' | 'Away'
  firstOdds: number | null
  latestOdds: number | null
  oddsDiff: number | null
  probDiffPp: number | null
  booksCount: number
}

const PAGE_SIZE = 12
const TEN_MINUTES_MS = 10 * 60 * 1000

function parseUtcMs(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

function formatSnapshotLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day}/${month} ${hh}:${mm}`
}

function buildSnapshotBuckets(trend: TrendPoint[]): ChartBucket[] {
  const validPoints = trend
    .filter(
      (pt): pt is TrendPoint & { outcome_role: 'home' | 'draw' | 'away' } =>
        Boolean(pt.extracted_at_utc) &&
        pt.odds_decimal > 0 &&
        (pt.outcome_role === 'home' || pt.outcome_role === 'draw' || pt.outcome_role === 'away'),
    )
    .sort((a, b) => parseUtcMs(a.extracted_at_utc) - parseUtcMs(b.extracted_at_utc))

  // 1. Дедупликираме суровите точки по (bookmaker_key, outcome_role) в рамките на 10 мин при еднакъв коефициент
  const lastPointByKey = new Map<string, { tsMs: number; odds: number }>()
  const dedupedPoints: Array<TrendPoint & { outcome_role: 'home' | 'draw' | 'away' }> = []

  for (const pt of validPoints) {
    const key = `${pt.bookmaker_key ?? ''}::${pt.outcome_role}`
    const tsMs = parseUtcMs(pt.extracted_at_utc)
    const prev = lastPointByKey.get(key)

    if (
      prev &&
      tsMs - prev.tsMs >= 0 &&
      tsMs - prev.tsMs <= TEN_MINUTES_MS &&
      Math.abs(pt.odds_decimal - prev.odds) <= 1e-4
    ) {
      continue
    }

    dedupedPoints.push(pt)
    lastPointByKey.set(key, { tsMs, odds: pt.odds_decimal })
  }

  // 2. Групираме по timestamp на снапшота
  const grouped = new Map<
    string,
    { tsMs: number; home: number[]; draw: number[]; away: number[]; books: Set<string> }
  >()

  for (const pt of dedupedPoints) {
    if (!grouped.has(pt.extracted_at_utc)) {
      grouped.set(pt.extracted_at_utc, {
        tsMs: parseUtcMs(pt.extracted_at_utc),
        home: [],
        draw: [],
        away: [],
        books: new Set(),
      })
    }
    const bucket = grouped.get(pt.extracted_at_utc)!
    bucket[pt.outcome_role].push(pt.odds_decimal)
    if (pt.bookmaker_key) {
      bucket.books.add(pt.bookmaker_key)
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

  const rawBuckets = Array.from(grouped.entries())
    .sort(([, a], [, b]) => a.tsMs - b.tsMs)
    .map(([ts, vals]) => ({
      ts,
      tsMs: vals.tsMs,
      label: formatSnapshotLabel(ts),
      home: Number(avg(vals.home).toFixed(2)),
      draw: Number(avg(vals.draw).toFixed(2)),
      away: Number(avg(vals.away).toFixed(2)),
      booksCount: vals.books.size,
    }))

  // 3. Премахваме последователни buckets до 10 мин с еднакви коефициенти (1, X, 2)
  const cleanBuckets: ChartBucket[] = []
  let prevKeptTsMs: number | null = null

  for (const b of rawBuckets) {
    const prevKept = cleanBuckets.length > 0 ? cleanBuckets[cleanBuckets.length - 1] : null
    const within10m =
      prevKept !== null &&
      prevKeptTsMs !== null &&
      b.tsMs - prevKeptTsMs >= 0 &&
      b.tsMs - prevKeptTsMs <= TEN_MINUTES_MS

    const sameOdds =
      prevKept !== null &&
      Math.abs(b.home - prevKept.home) <= 0.005 &&
      Math.abs(b.draw - prevKept.draw) <= 0.005 &&
      Math.abs(b.away - prevKept.away) <= 0.005

    if (within10m && sameOdds) {
      continue
    }

    cleanBuckets.push({
      index: cleanBuckets.length,
      ts: b.ts,
      label: b.label,
      home: b.home,
      draw: b.draw,
      away: b.away,
      booksCount: b.booksCount,
    })
    prevKeptTsMs = b.tsMs
  }

  return cleanBuckets
}

function OddsChart({
  buckets,
  mode,
  selectedSnapshotIdx,
  onSelectSnapshot,
}: {
  buckets: ChartBucket[]
  mode: 'odds' | 'probability'
  selectedSnapshotIdx: number | null
  onSelectSnapshot: (idx: number | null) => void
}) {
  if (buckets.length === 0) {
    return (
      <div className="py-16 text-center text-xs text-slate-400">
        No historical snapshots available for this fixture.
      </div>
    )
  }

  const width = 800
  const height = 250
  const top = 18
  const bottom = 205
  const left = 42
  const right = 775
  const lastIdx = buckets.length - 1

  const series = [
    { key: 'home', label: 'Home', color: '#059669' },
    { key: 'draw', label: 'Draw', color: '#64748b' },
    { key: 'away', label: 'Away', color: '#2563eb' },
  ] as const

  const values = buckets.flatMap((point) =>
    series
      .map((s) => {
        const raw = point[s.key]
        if (raw <= 0) return null
        return mode === 'odds' ? raw : 100 / raw
      })
      .filter((v): v is number => v !== null),
  )

  const safeMin = values.length ? Math.min(...values) : 1
  const safeMax = values.length ? Math.max(...values) : 3
  const min = Math.floor(safeMin * 0.9 * 10) / 10
  const max = Math.ceil(safeMax * 1.08 * 10) / 10
  const x = (index: number) =>
    lastIdx === 0 ? (left + right) / 2 : left + (index * (right - left)) / lastIdx
  const y = (value: number) =>
    max === min ? (top + bottom) / 2 : bottom - ((value - min) / (max - min)) * (bottom - top)
  const ticks = [0, 1, 2, 3, 4].map((i) => min + ((max - min) * i) / 4)

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[680px]">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y(tick)}
              x2={right}
              y2={y(tick)}
              stroke="#e8edf3"
              strokeDasharray="3 4"
            />
            <text
              x={left - 9}
              y={y(tick) + 4}
              textAnchor="end"
              fill="#94a3b8"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              {mode === 'odds' ? tick.toFixed(1) : `${tick.toFixed(0)}%`}
            </text>
          </g>
        ))}

        {selectedSnapshotIdx !== null && buckets[selectedSnapshotIdx] && (
          <line
            x1={x(selectedSnapshotIdx)}
            y1={top}
            x2={x(selectedSnapshotIdx)}
            y2={bottom}
            stroke="#0f172a"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        )}

        <line
          x1={x(lastIdx)}
          y1={top}
          x2={x(lastIdx)}
          y2={bottom}
          stroke="#cbd5e1"
          strokeDasharray="4 4"
        />

        {series.map((item) => {
          const pts = buckets
            .map((point, index) => {
              const raw = point[item.key]
              if (raw <= 0) return null
              const val = mode === 'odds' ? raw : 100 / raw
              return { index, val, coord: `${x(index)},${y(val)}` }
            })
            .filter((p): p is { index: number; val: number; coord: string } => p !== null)

          return (
            <g key={item.key}>
              {pts.length > 1 && (
                <polyline
                  points={pts.map((p) => p.coord).join(' ')}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {pts.map((p) => {
                const isSelected = selectedSnapshotIdx === p.index
                const isEndpoint = p.index === 0 || p.index === lastIdx
                return (
                  <circle
                    key={p.index}
                    cx={x(p.index)}
                    cy={y(p.val)}
                    r={isSelected ? 6.5 : isEndpoint ? 5 : 3.5}
                    fill={isSelected ? item.color : p.index === 0 ? '#f8fafc' : 'white'}
                    stroke={item.color}
                    strokeWidth={isSelected || isEndpoint ? 2.5 : 2}
                    className="cursor-pointer"
                    onClick={() => onSelectSnapshot(isSelected ? null : p.index)}
                  />
                )
              })}
            </g>
          )
        })}

        {buckets.map((point, index) => {
          const isSelected = selectedSnapshotIdx === index
          const tag = ` #${index + 1}`
          return (
            <text
              key={`${point.ts}-${index}`}
              x={x(index)}
              y="231"
              textAnchor={index === 0 ? 'start' : index === lastIdx ? 'end' : 'middle'}
              fill={isSelected || index === 0 || index === lastIdx ? '#0f172a' : '#94a3b8'}
              fontSize="9.5"
              fontWeight={isSelected || index === 0 || index === lastIdx ? '700' : '400'}
              className="cursor-pointer"
              onClick={() => onSelectSnapshot(isSelected ? null : index)}
            >
              {point.label}
              {tag}
            </text>
          )
        })}
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

export function LineMovementCard({
  match,
  trend,
  movementRows,
  chartMode,
  onChartModeChange,
}: LineMovementCardProps) {
  const [roleFilter, setRoleFilter] = useState<'all' | 'home' | 'draw' | 'away'>('all')
  const [selectedSnapshotIdx, setSelectedSnapshotIdx] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
    setSelectedSnapshotIdx(null)
  }, [match?.event_id, roleFilter, movementRows.length])

  const buckets = useMemo(() => buildSnapshotBuckets(trend), [trend])

  const activeBucket =
    selectedSnapshotIdx !== null && buckets[selectedSnapshotIdx]
      ? buckets[selectedSnapshotIdx]
      : null

  const consensusSummary = useMemo<ConsensusSummaryItem[]>(() => {
    const roles: Array<{ role: 'home' | 'draw' | 'away'; label: 'Home' | 'Draw' | 'Away' }> = [
      { role: 'home', label: 'Home' },
      { role: 'draw', label: 'Draw' },
      { role: 'away', label: 'Away' },
    ]

    const avg = (nums: number[]) =>
      nums.length ? nums.reduce((acc, val) => acc + val, 0) / nums.length : null

    return roles.map(({ role, label }) => {
      const rows = movementRows.filter((r) => r.outcome_role === role)
      if (rows.length === 0) {
        return {
          role,
          label,
          firstOdds: null,
          latestOdds: null,
          oddsDiff: null,
          probDiffPp: null,
          booksCount: 0,
        }
      }

      const firstOdds = avg(rows.map((r) => r.first_odds))
      const latestOdds = avg(rows.map((r) => r.latest_odds))
      const oddsDiff =
        firstOdds !== null && latestOdds !== null ? latestOdds - firstOdds : null
      const probDiffPp = avg(rows.map((r) => r.prob_diff_pp))

      return {
        role,
        label,
        firstOdds,
        latestOdds,
        oddsDiff,
        probDiffPp,
        booksCount: rows.length,
      }
    })
  }, [movementRows])

  const tableRows = useMemo(() => {
    const baseRows = activeBucket
      ? trend
          .filter((pt) => pt.extracted_at_utc === activeBucket.ts && pt.odds_decimal > 0)
          .map((pt, idx) => {
            const prevBucket =
              activeBucket.index > 0 ? buckets[activeBucket.index - 1] : null
            const prevAvg =
              prevBucket &&
              (pt.outcome_role === 'home' ||
                pt.outcome_role === 'draw' ||
                pt.outcome_role === 'away')
                ? prevBucket[pt.outcome_role]
                : null
            const diffFromPrev =
              prevAvg && prevAvg > 0 ? Number((pt.odds_decimal - prevAvg).toFixed(2)) : 0
            const prob = Number((pt.implied_probability * 100).toFixed(1))
            const prevProb = prevAvg && prevAvg > 0 ? 100 / prevAvg : prob
            const probDiffPp = Number((prob - prevProb).toFixed(1))

            return {
              id: `${pt.bookmaker_key}-${pt.outcome_role}-${idx}`,
              outcome_name: pt.outcome_name,
              bookmaker_key: pt.bookmaker_key,
              outcome_role: pt.outcome_role,
              leftVal: prevAvg && prevAvg > 0 ? prevAvg : pt.odds_decimal,
              rightVal: pt.odds_decimal,
              oddsDiff: diffFromPrev,
              probDiffPp,
            }
          })
      : movementRows.map((row, idx) => ({
          id: `${row.bookmaker_key}-${row.outcome_role}-${idx}`,
          outcome_name: row.outcome_name,
          bookmaker_key: row.bookmaker_key,
          outcome_role: row.outcome_role,
          leftVal: row.first_odds,
          rightVal: row.latest_odds,
          oddsDiff: row.odds_diff,
          probDiffPp: row.prob_diff_pp,
        }))

    if (roleFilter === 'all') return baseRows
    return baseRows.filter((row) => row.outcome_role === roleFilter)
  }, [activeBucket, buckets, movementRows, roleFilter, trend])

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return tableRows.slice(start, start + PAGE_SIZE)
  }, [tableRows, safePage])

  if (!match) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-xs text-slate-400">
        Select a fixture to inspect odds movement.
      </section>
    )
  }

  const startIdx = tableRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const endIdx = Math.min(tableRows.length, safePage * PAGE_SIZE)

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-emerald-700">
              {match.sport_key}
            </span>
            <span className="text-[10px] text-slate-400">{match.commence_time_utc}</span>
          </div>
          <h3 className="text-sm font-bold">
            {match.home_team} <span className="mx-1 font-normal text-slate-300">vs</span>{' '}
            {match.away_team}
          </h3>
        </div>

        <div className="flex rounded-lg bg-slate-100 p-1">
          {(['odds', 'probability'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChartModeChange(mode)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-bold capitalize transition ${
                chartMode === mode
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-2 pt-4 sm:px-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 pl-1">
          <div className="flex flex-wrap gap-4">
            {[
              ['Home (1)', 'bg-emerald-600'],
              ['Draw (X)', 'bg-slate-500'],
              ['Away (2)', 'bg-blue-600'],
            ].map(([label, color]) => (
              <span
                key={label}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"
              >
                <i className={`h-2 w-2 rounded-full ${color}`} />
                {label}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">
            {buckets.length} snapshots · Click a point or pill to inspect
          </span>
        </div>
        <OddsChart
          buckets={buckets}
          mode={chartMode}
          selectedSnapshotIdx={selectedSnapshotIdx}
          onSelectSnapshot={(idx) => {
            setSelectedSnapshotIdx(idx)
            setPage(1)
          }}
        />
      </div>

      {buckets.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-slate-500">
              Snapshots ({buckets.length})
            </span>
            {activeBucket && (
              <button
                type="button"
                onClick={() => setSelectedSnapshotIdx(null)}
                className="text-[10px] font-semibold text-emerald-700 hover:underline"
              >
                Reset to First → Latest
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {buckets.map((b, idx) => {
              const isSelected = selectedSnapshotIdx === idx
              const tagLabel =
                idx === 0
                  ? 'Initial'
                  : idx === buckets.length - 1
                    ? 'Latest'
                    : `Pull #${idx + 1}`

              return (
                <button
                  key={`${b.ts}-${idx}`}
                  type="button"
                  onClick={() => {
                    setSelectedSnapshotIdx(isSelected ? null : idx)
                    setPage(1)
                  }}
                  className={`min-w-[154px] shrink-0 rounded-lg border px-3 py-2 text-left text-[11px] transition ${
                    isSelected
                      ? 'border-slate-800 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <span className="font-bold">
                      #{idx + 1} · {tagLabel}
                    </span>
                    <span className={isSelected ? 'text-slate-300' : 'text-slate-400'}>
                      {b.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-1.5 font-mono text-[10px] tabular-nums">
                    <span>1: {b.home.toFixed(2)}</span>
                    <span>X: {b.draw.toFixed(2)}</span>
                    <span>2: {b.away.toFixed(2)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid gap-2.5 border-t border-slate-100 bg-slate-50/50 px-5 py-3 sm:grid-cols-3">
        {consensusSummary.map((item) => {
          const diff = item.oddsDiff ?? 0
          const probDiff = item.probDiffPp ?? 0
          const toneClass =
            item.oddsDiff === null || Math.abs(diff) < 0.005
              ? 'text-slate-400'
              : diff < 0
                ? 'text-emerald-600'
                : 'text-rose-600'
          const signOdds = diff > 0 ? '+' : ''
          const signProb = probDiff > 0 ? '+' : ''

          return (
            <div
              key={item.role}
              className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-[11px]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
                  {item.label} consensus
                </span>
                <span className="text-[10px] text-slate-400">{item.booksCount} books</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 font-mono tabular-nums">
                <span className="text-slate-500">
                  {item.firstOdds !== null ? item.firstOdds.toFixed(2) : '—'}
                  <span className="mx-1 text-slate-300">→</span>
                  <strong className="font-bold text-slate-900">
                    {item.latestOdds !== null ? item.latestOdds.toFixed(2) : '—'}
                  </strong>
                </span>
                {item.oddsDiff !== null && item.probDiffPp !== null ? (
                  <span className={`font-semibold ${toneClass}`}>
                    {signOdds}
                    {diff.toFixed(2)} ({signProb}
                    {probDiff.toFixed(1)}%)
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5">
        <div className="flex items-center gap-1.5">
          {(
            [
              ['all', 'All'],
              ['home', 'Home'],
              ['draw', 'Draw'],
              ['away', 'Away'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${
                roleFilter === key
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="text-[10px] tabular-nums text-slate-400">
          {activeBucket ? `Snapshot #${activeBucket.index + 1} (${activeBucket.label}) · ` : ''}
          {tableRows.length === 0 ? '0 rows' : `${startIdx}–${endIdx} of ${tableRows.length}`}
        </span>
      </div>

      <div className="border-t border-slate-100">
        <div className="grid grid-cols-[1.6fr_repeat(4,1fr)] bg-slate-50 px-5 py-2 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">
          <span>Outcome · Bookmaker</span>
          <span>{activeBucket ? 'Prev avg' : 'First'}</span>
          <span>{activeBucket ? `#${activeBucket.index + 1}` : 'Latest'}</span>
          <span>Odds Δ</span>
          <span>Prob. Δ</span>
        </div>

        {pageRows.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-400">
            No movement rows for this filter.
          </div>
        ) : (
          pageRows.map((row) => {
            const toneClass =
              Math.abs(row.oddsDiff) < 0.005
                ? 'text-slate-400'
                : row.oddsDiff < 0
                  ? 'text-emerald-600'
                  : 'text-rose-600'
            const signOdds = row.oddsDiff > 0 ? '+' : ''
            const signProb = row.probDiffPp > 0 ? '+' : ''

            return (
              <div
                key={row.id}
                className="grid grid-cols-[1.6fr_repeat(4,1fr)] border-t border-slate-100 px-5 py-2.5 text-[11px]"
              >
                <span className="truncate pr-2 font-bold text-slate-700">
                  {row.outcome_name} · {row.bookmaker_key}
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  {row.leftVal.toFixed(2)}
                </span>
                <span className="font-mono font-bold tabular-nums text-slate-800">
                  {row.rightVal.toFixed(2)}
                </span>
                <span className={`font-mono font-bold tabular-nums ${toneClass}`}>
                  {signOdds}
                  {row.oddsDiff.toFixed(2)}
                </span>
                <span className={`font-mono font-bold tabular-nums ${toneClass}`}>
                  {signProb}
                  {row.probDiffPp.toFixed(1)}%
                </span>
              </div>
            )
          })
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2.5 text-[11px]">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setPage(num)}
                className={`h-6 min-w-[24px] rounded px-1.5 font-mono text-[10px] font-bold transition ${
                  num === safePage
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {num}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </section>
  )
}