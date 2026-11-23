import { Icon } from './Icon'

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Icon name="football" className="h-[19px] w-[19px]" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-[-0.015em] text-slate-950">MarketLine</h1>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Football intelligence</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Data services operational
        </div>
      </div>
    </header>
  )
}