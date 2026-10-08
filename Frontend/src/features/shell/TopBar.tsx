import { Bell, CalendarDays, LogOut } from 'lucide-react'
import type { User } from '@/api'
import { Avatar, ThemeToggle } from '@/components/ui'
import type { NavItem } from './nav'

interface Props {
  user: User
  nav: NavItem[]
  view: string
  onNavigate: (view: string) => void
  onLogout: () => void
}

function greeting(date = new Date()) {
  const hour = date.getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export function TopBar({ user, nav, view, onNavigate, onLogout }: Props) {
  // platform admins get no notifications from the backend
  const hasBell = user.role !== 'PLATFORM_ADMIN'

  return (
    <header className="mb-5 flex items-center gap-3 rounded-[28px] bg-surface/70 p-3 pl-4 backdrop-blur">
      <button onClick={() => onNavigate('profile')}>
        <Avatar u={user} size="size-11" />
      </button>
      <div className="flex-1 leading-tight">
        <div className="text-xs text-muted">
          {greeting()}, <b className="text-ink">{user.firstName}</b> 👋
        </div>
        <div className="text-sm font-bold">{nav.find((item) => item.key === view)?.label}</div>
      </div>
      <span className="hidden h-11 items-center gap-2 rounded-full bg-surface px-4 text-xs font-semibold sm:flex">
        <CalendarDays className="size-4 text-brand" />
        {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
      </span>
      <ThemeToggle />
      {hasBell && (
        <button
          onClick={() => onNavigate('alerts')}
          aria-label="Notifications"
          className="relative grid size-11 place-items-center rounded-full bg-surface"
        >
          <Bell className="size-[18px]" />
        </button>
      )}
      <button
        onClick={onLogout}
        aria-label="Sign out"
        className="grid size-11 place-items-center rounded-full bg-surface lg:hidden"
      >
        <LogOut className="size-[18px]" />
      </button>
    </header>
  )
}
