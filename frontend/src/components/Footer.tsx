type FooterProps = {
  lastSyncUtc: string | null
}

export function Footer({ lastSyncUtc }: FooterProps) {
  return (
    <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-slate-200 pt-4 text-[11px] text-slate-400 sm:flex-row">
      <span>Sports Odds & Movement Analytics</span>
      <span className="font-mono tabular-nums">
        Last sync UTC: {lastSyncUtc ?? '—'}
      </span>
    </footer>
  )
}