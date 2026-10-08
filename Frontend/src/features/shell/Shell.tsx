import { useEffect, useState } from 'react'
import type { User } from '@/api'
import { AmbientBackground } from '@/components/ui'
import { useDirectory } from '@/state/directory'
import { HospitalBanner } from './HospitalBanner'
import { MobileNav } from './MobileNav'
import { navFor } from './nav'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { renderView } from './views'

/** The signed-in workspace: navigation around the page of the current view. */
export function Shell({ user: signedIn, onLogout }: { user: User; onLogout: () => void }) {
  const [user, setUser] = useState(signedIn)

  // lets the stylesheet scale the interface up on large screens for the workspace only
  useEffect(() => {
    document.documentElement.dataset.shell = ''
    return () => {
      delete document.documentElement.dataset.shell
    }
  }, [])
  const nav = navFor(user.role)
  const [view, setView] = useState(nav[0].key)
  const dir = useDirectory(user)

  // a hospital admin can sign in while the hospital is still pending review, but nothing works until approval
  const hospitalLive = user.role !== 'HOSPITAL_ADMIN' || user.hospital?.status === 'APPROVED'

  return (
    <div className="min-h-screen p-3 sm:p-4 lg:p-5 2xl:p-8">
      <AmbientBackground />
      <div className="flex w-full gap-5 2xl:gap-8">
        <Sidebar user={user} nav={nav} view={view} onNavigate={setView} onLogout={onLogout} />

        <main className="min-w-0 flex-1 pb-28 lg:pb-8">
          <TopBar user={user} nav={nav} view={view} onNavigate={setView} onLogout={onLogout} />
          {!hospitalLive && <HospitalBanner user={user} onRefresh={setUser} />}
          <div key={view} className="animate-rise">
            {renderView(view, {
              user,
              dir,
              go: setView,
              onProfileSaved: (saved) => setUser({ ...user, ...saved }),
              onLogout,
            })}
          </div>
        </main>
      </div>

      <MobileNav nav={nav} view={view} onNavigate={setView} />
    </div>
  )
}
