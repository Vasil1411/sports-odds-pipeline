type IconName = 'calendar' | 'refresh' | 'clock' | 'chevron' | 'trend' | 'check' | 'football'

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, JSX.Element> = {
    calendar: <><path d="M8 2v4M16 2v4M3 9h18" /><rect x="3" y="4" width="18" height="17" rx="2" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M18.5 15a7.5 7.5 0 1 1 .6-7.7L20 11" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    trend: <><path d="M3 17 9 11l4 4 8-9" /><path d="M15 6h6v6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    football: <><circle cx="12" cy="12" r="9" /><path d="m9 9 3-2 3 2-1 4h-4L9 9ZM12 7V3M10 13l-3 3M14 13l3 3M7 16l1 3M17 16l-1 3" /></>,
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}