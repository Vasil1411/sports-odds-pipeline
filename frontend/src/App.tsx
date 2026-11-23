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

export default function App() {
  const todayUtc = new Date().toISOString().slice(0, 10)

  const [date, setDate] = useState(todayUtc)
  const [tournament, setTournament] = useState('All Tournaments')
  const [tournaments, setTournaments] = useState<string[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedId, setSelectedId] = useState<string | number | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [movementRows, setMovementRows] = useState<MovementRow[]>([])
  const [postMatch, setPostMatch] = useState<PostMatchSummary | null>(null)
  const [lastSyncUtc, setLastSyncUtc] = useState<string | null>(null)
  const [chartMode, setChartMode] = useState<'odds' | 'probability'>('odds')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDashboardData(date)
      setMatches(data.matches)
      setTournaments(data.tournaments)
      setPostMatch(data.postMatch)
      setLastSyncUtc(data.lastSyncUtc)
      setSelectedId((prev) =>
        prev && data.matches.some((m) => m.id === prev) ? prev : (data.matches[0]?.id ?? null),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неуспешно зареждане от API')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    if (!selectedId) {
      setTrend([])
      setMovementRows([])
      return
    }
    fetchMatchMovement(selectedId)
      .then((res) => {
        setTrend(res.trend)
        setMovementRows(res.movementRows)
      })
      .catch(() => {
        setTrend([])
        setMovementRows([])
      })
  }, [selectedId])

  const visibleMatches = useMemo(
    () => (tournament === 'All Tournaments' ? matches : matches.filter((match) => match.tournament === tournament)),
    [matches, tournament],
  )

  const selectedMatch = matches.find((match) => match.id === selectedId) ?? null

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      await triggerPipelineSync()
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
          selectedId={selectedMatch?.id ?? null}
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