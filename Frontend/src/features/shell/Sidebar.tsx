import { LogOut } from 'lucide-react'
import type { User } from '@/api'
import { Avatar, Button, Logo } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { displayName } from '@/lib/format'
import { ROLE_LABEL, type NavItem } from './nav'

interface Props {
  user: User
  nav: NavItem[]
  view: string
  onNavigate: (view: string) => void
  onLogout: () => void
}

/** Desktop navigation rail. On small screens the same items appear in <MobileNav />. */
export function Sidebar({ user, nav, view, onNavigate, onLogout }: Props) {
  return (
    <aside className="sticky top-5 hidden h-[calc(100vh-2.5rem)] w-64 shrink-0 2xl:top-8 2xl:h-[calc(100vh-4rem)] 2xl:w-72 flex-col rounded-[28px] bg-surface/70 p-4 backdrop-blur lg:flex">
      <div className="flex items-center gap-2 px-2 py-2">
        <Logo />
        <span className="text-lg font-extrabold tracking-tight">MediCue</span>
      </div>
      <div className="mt-2 mb-6 px-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
        {ROLE_LABEL[user.role]} workspace
      </div>

      <nav className="space-y-1">
        {nav.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={cx(
              'flex h-12 w-full items-center gap-3 rounded-2xl px-4 text-sm font-semibold transition',
              view === item.key
                ? 'bg-brand text-white shadow-[0_10px_24px_-12px_rgba(59,107,224,0.9)]'
                : 'text-muted hover:bg-surface hover:text-ink',
            )}
          >
            <item.icon className="size-[18px]" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-3xl bg-mist p-3">
        <button onClick={() => onNavigate('profile')} className="flex w-full items-center gap-3 text-left">
          <Avatar u={user} size="size-10" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{displayName(user)}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
        </button>
        <Button variant="white" className="mt-3 w-full !h-10" onClick={onLogout}>
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
