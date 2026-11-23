export function Footer() {
  return (
    <footer className="flex flex-col gap-2 px-1 pb-2 pt-5 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <p>Odds normalized to decimal format. Implied probabilities may include bookmaker margin.</p>
      <p className="font-mono">Last successful sync: 14 May 2025, 19:01:08 UTC</p>
    </footer>
  )
}