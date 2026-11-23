import { Icon } from './Icon'

type ToolbarProps = {
  tournaments: string[]
  tournament: string
  onTournamentChange: (value: string) => void
  date: string
  onDateChange: (value: string) => void
  syncing: boolean
  onSync: () => void
}

export function Toolbar({
  tournaments,
  tournament,
  onTournamentChange,
  date,
  onDateChange,
  syncing,
  onSync,
}: ToolbarProps) {
  return (
    <section className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-600">Market overview</p>
        <h2 className="text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[28px]">Football odds & line movement</h2>
        <p className="mt-1.5 text-sm text-slate-500">Consensus pricing from verified bookmakers across global competitions.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="relative flex min-w-[220px] items-center">
          <span className="absolute left-3 h-2 w-2 rounded-full bg-emerald-500" />
          <select
            value={tournament}
            onChange={(e) => onTournamentChange(e.target.value)}
            className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-8 pr-9 text-[13px] font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus:border-slate-400"
          >
            {['All Tournaments', ...tournaments].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <Icon name="chevron" className="pointer-events-none absolute right-3 h-4 w-4 text-slate-400" />
        </label>

        <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700">
          <Icon name="calendar" className="h-4 w-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-[118px] bg-transparent outline-none [color-scheme:light]"
          />
        </label>

        <div className="flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-700">
          <Icon name="clock" className="h-3.5 w-3.5" />
          <span>UTC · T−1h snapshot</span>
        </div>

        <button
          onClick={onSync}
          disabled={syncing}
          className="flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98] disabled:opacity-60"
        >
          <Icon name="refresh" className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </section>
  )
}