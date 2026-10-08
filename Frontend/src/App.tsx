import { useEffect, useState } from 'react'
import { isMock, onAuthExpired, runScheduledJobs, setSession, type User } from '@/api'
import { ApiConsole } from '@/components/ApiConsole'
import { Toasts } from '@/components/Toasts'
import { AuthPage } from '@/features/auth/AuthPage'
import { Shell } from '@/features/shell/Shell'
import { toast } from '@/lib/toast'

const SCHEDULED_JOBS_INTERVAL_MS = 60_000

export default function App() {
  const [user, setUser] = useState<User | null>(null)

  // the mock has no server, so it runs the scheduled jobs (hold expiry, offer expiry, missed sessions) itself
  useEffect(() => {
    if (!isMock) return
    const timer = setInterval(runScheduledJobs, SCHEDULED_JOBS_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  // an expired or revoked token (HTTP 401) sends the user back to sign in
  useEffect(
    () =>
      onAuthExpired(() => {
        setSession(null)
        setUser(null)
        toast('Your session expired. Please sign in again.', false)
      }),
    [],
  )

  const signOut = () => {
    setSession(null)
    setUser(null)
  }

  return (
    <>
      <Toasts />
      {user ? <Shell key={user.email} user={user} onLogout={signOut} /> : <AuthPage onLogin={setUser} />}
      <ApiConsole />
    </>
  )
}
