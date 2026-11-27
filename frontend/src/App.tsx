import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalibrationSummaryCard } from './components/CalibrationSummaryCard'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { LineMovementCard } from './components/LineMovementCard'
import { MatchesTable } from './components/MatchesTable'
import { PostMatchCard } from './components/PostMatchCard'
import { Toolbar } from './components/Toolbar'
import {
  fetchCalibrationSummary,
  fetchDashboardData,
  fetchMatchMovement,
  triggerPipelineSync,
} from './services/oddsApi'
import { type CalibrationSummaryRow } from './types/calibrationSummary'
import { type Match } from './types/match'
import { type MovementRow } from './types/movementRow'
import { type PostMatchSummary } from './types/postMatchSummary'
import { type TrendPoint } from './types/trendPoint'

const ALL_TOURNAMENTS = 'All Tournaments'
type ActiveTab = 'odds' | 'calibration'

export default function App() {
  const todayUtc = new Date().toISOString().slice(0, 10)

  const [activeTab, setActiveTab] = useState<ActiveTab>('odds')
  const [date, setDate] = useState(todayUtc)
  const [tournament, setTournament] = useState(ALL_TOURNAMENTS)
  const [tournaments, setTournaments] = useState<string[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [movementRows, setMovementRows] = useState<MovementRow[]>([])
  const [postMatchList, setPostMatchList] = useState<PostMatchSummary[]>([])
  const [calibrationRows, setCalibrationRows] = useState<CalibrationSummaryRow[]>([])
  const [lastSyncUtc, setLastSyncUtc] = useState<string | null>(null)
  const [chartMode, setChartMode] = useState<'odds' | 'probability'>('odds')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const sportKey = tournament === ALL_TOURNAMENTS ? undefined : tournament
        const data = await fetchDashboardData(date, { sportKey, signal })
        if (signal?.aborted) return

        let availableTournaments = data.tournaments
        if (sportKey) {
          const allForDate = await fetchDashboardData(date, { signal })
          if (signal?.aborted) return
          if (allForDate.tournaments.length > 0) {
            availableTournaments = allForDate.tournaments
          }
        }

        setMatches(data.matches)
        setTournaments(availableTournaments)
        setPostMatchList(data.postMatchList ?? (data.postMatch ? [data.postMatch] : []))
        setLastSyncUtc(data.lastSyncUtc)

        if (
          tournament !== ALL_TOURNAMENTS &&
          availableTournaments.length > 0 &&
          !availableTournaments.includes(tournament)
        ) {
          setTournament(ALL_TOURNAMENTS)
        }

        setSelectedId((prev) =>
          prev && data.matches.some((m) => m.event_id === prev)
            ? prev
            : (data.matches[0]?.event_id ?? null),
        )
      } catch (err) {
        if (signal?.aborted) return
        setError(err instanceof Error ? err.message : 'Неуспешно зареждане от API')
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    },
    [date, tournament],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadDashboard(controller.signal)
    return () => controller.abort()
  }, [loadDashboard])

  useEffect(() => {
    const controller = new AbortController()
    const sportKey = tournament === ALL_TOURNAMENTS ? undefined : tournament

    fetchCalibrationSummary({ sportKey, signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return
        setCalibrationRows(rows)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('Неуспешно зареждане на калибрацията:', err)
        setCalibrationRows([])
      })

    return () => controller.abort()
  }, [tournament])

  useEffect(() => {
    if (!selectedId) {
      setTrend([])
      setMovementRows([])
      return
    }

    const controller = new AbortController()
    fetchMatchMovement(selectedId, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setTrend(res.trend)
        setMovementRows(res.movementRows)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('Неуспешно зареждане на движението:', err)
        setTrend([])
        setMovementRows([])
      })

    return () => controller.abort()
  }, [selectedId])

  const visibleMatches = useMemo(
    () =>
      tournament === ALL_TOURNAMENTS
        ? matches
        : matches.filter((match) => match.sport_key === tournament),
    [matches, tournament],
  )

  const selectedMatch = useMemo(
    () => matches.find((match) => match.event_id === selectedId) ?? null,
    [matches, selectedId],
  )

  const handleDateChange = (newDate: string) => {
    setDate(newDate)
    setTournament(ALL_TOURNAMENTS)
  }

  const selectedPostMatch = useMemo(() => {
    if (!selectedMatch) return null
    const matchDate = selectedMatch.commence_time_utc?.slice(0, 10)

    return (
      postMatchList.find(
        (item) =>
          (item.eventId && item.eventId === selectedMatch.event_id) ||
          (item.home === selectedMatch.home_team &&
            item.away === selectedMatch.away_team &&
            (!matchDate || !item.date || item.date === matchDate)),
      ) ?? null
    )
  }, [postMatchList, selectedMatch])

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const sportKey = tournament === ALL_TOURNAMENTS ? undefined : tournament
      await triggerPipelineSync({ sportKey })
      await loadDashboard()
      const updatedSummary = await fetchCalibrationSummary({ sportKey })
      setCalibrationRows(updatedSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при синхронизация')
    } finally {
      setSyncing(false)
    }
  }

  const calibrationKpis = useMemo(() => {
    if (calibrationRows.length === 0) return null
    const totalMatches = calibrationRows.reduce((acc, r) => acc + (r.unique_matches || 0), 0)
    const favPicks = calibrationRows.reduce((acc, r) => acc + (r.favorite_picks || 0), 0)
    const favWins = calibrationRows.reduce((acc, r) => acc + (r.favorite_wins || 0), 0)
    const favHit = favPicks > 0 ? `${((favWins / favPicks) * 100).toFixed(1)}%` : '—'

    const weightedGoals =
      totalMatches > 0
        ? (
            calibrationRows.reduce(
              (acc, r) => acc + r.avg_total_goals * (r.unique_matches || 0),
              0,
            ) / totalMatches
          ).toFixed(2)
        : '—'

    const weightedBlowout =
      totalMatches > 0
        ? `${(
            (calibrationRows.reduce(
              (acc, r) => acc + r.blowout_2plus_rate * (r.unique_matches || 0),
              0,
            ) /
              totalMatches) *
            100
          ).toFixed(1)}%`
        : '—'

    return { totalMatches, favHit, weightedGoals, weightedBlowout }
  }, [calibrationRows])

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-slate-900">
      <Header />
      <main className="mx-auto max-w-[1480px] px-5 py-6 lg:px-8 lg:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveTab('odds')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'odds'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Odds &amp; Movement
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calibration')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'calibration'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Calibration &amp; Scoring ({calibrationRows.length})
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}

        {activeTab === 'odds' ? (
          <>
            <Toolbar
              tournaments={tournaments}
              tournament={tournament}
              onTournamentChange={setTournament}
              date={date}
              onDateChange={handleDateChange}
              syncing={syncing}
              onSync={handleSync}
            />

            <MatchesTable
              matches={visibleMatches}
              selectedId={selectedMatch?.event_id ?? null}
              onSelectMatch={setSelectedId}
              loading={loading}
            />

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
              <LineMovementCard
                match={selectedMatch}
                trend={trend}
                movementRows={movementRows}
                chartMode={chartMode}
                onChartModeChange={setChartMode}
              />
              <PostMatchCard
                result={selectedPostMatch}
                selectedMatch={selectedMatch}
                movementRows={movementRows}
              />
            </div>
          </>
        ) : (
          <div className="space-y-5">
            {calibrationKpis && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Evaluated Match Roles
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                    {calibrationKpis.totalMatches}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Consensus Favorite Hit
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                    {calibrationKpis.favHit}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Weighted Avg Goals
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                    {calibrationKpis.weightedGoals}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Blowout Rate (2+ Goals)
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                    {calibrationKpis.weightedBlowout}
                  </div>
                </div>
              </div>
            )}

            <CalibrationSummaryCard rows={calibrationRows} />
          </div>
        )}

        <Footer lastSyncUtc={lastSyncUtc} />
      </main>
    </div>
  )
}