import { useCallback, useEffect, useMemo, useState } from 'react'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { LineMovementCard } from './components/LineMovementCard'
import { MatchesTable } from './components/MatchesTable'
import { PostMatchCard } from './components/PostMatchCard'
import { Toolbar } from './components/Toolbar'
import { fetchDashboardData, fetchMatchMovement, triggerPipelineSync } from './services/oddsApi'
import { type Match } from './types/match'
import { type MovementRow } from './types/movementRow'
import { type PostMatchSummary } from './types/postMatchSummary'
import { type TrendPoint } from './types/trendPoint'

const ALL_TOURNAMENTS = 'All Tournaments'

export default function App() {
  const todayUtc = new Date().toISOString().slice(0, 10)

  const [date, setDate] = useState(todayUtc)
  const [tournament, setTournament] = useState(ALL_TOURNAMENTS)
  const [tournaments, setTournaments] = useState<string[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [movementRows, setMovementRows] = useState<MovementRow[]>([])
  const [postMatch, setPostMatch] = useState<PostMatchSummary | null>(null)
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

        setMatches(data.matches)
        setTournaments(data.tournaments)
        setPostMatch(data.postMatch)
        setLastSyncUtc(data.lastSyncUtc)
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

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const sportKey = tournament === ALL_TOURNAMENTS ? undefined : tournament
      await triggerPipelineSync({ sportKey })
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка при синхронизация')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-slate-900">
      <Header />
      <main className="mx-auto max-w-[1480px] px-5 py-6 lg:px-8 lg:py-8">
        <Toolbar
          tournaments={tournaments}
          tournament={tournament}
          onTournamentChange={setTournament}
          date={date}
          onDateChange={setDate}
          syncing={syncing}
          onSync={handleSync}
        />

        {error && (
          <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}

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
          <PostMatchCard result={postMatch} />
        </div>

        <Footer lastSyncUtc={lastSyncUtc} />
      </main>
    </div>
  )
}