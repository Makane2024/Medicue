import { cx } from '@/lib/classNames'
import type { NavItem } from './nav'

interface Props {
  nav: NavItem[]
  view: string
  onNavigate: (view: string) => void
}

/** Bottom navigation bar for screens narrower than `lg`. */
export function MobileNav({ nav, view, onNavigate }: Props) {
  return (
    <nav className="fixed inset-x-4 bottom-4 z-30 flex justify-around rounded-full bg-surface p-2 shadow-xl lg:hidden">
      {nav.map((item) => (
        <button
          key={item.key}
          onClick={() => onNavigate(item.key)}
          aria-label={item.label}
          className={cx(
            'grid size-11 place-items-center rounded-full transition',
            view === item.key ? 'bg-brand text-white' : 'text-ink/70',
          )}
        >
          <item.icon className="size-5" />
        </button>
      ))}
    </nav>
  )
}
