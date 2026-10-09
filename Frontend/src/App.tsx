import { useEffect, useState } from 'react'
import { api, onAuthExpired, renewSession, setSession, type User } from '@/api'
import { Toasts } from '@/components/Toasts'
import { AuthPage } from '@/features/auth/AuthPage'
import { enterApp } from '@/features/auth/useSignIn'
import { Shell } from '@/features/shell/Shell'
import { toast } from '@/lib/toast'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  // a page load asks the server to renew the session from the HttpOnly cookie instead of showing the sign-in page
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    renewSession()
      .then((idToken) => (idToken ? enterApp(idToken).then(setUser) : undefined))
      .catch(() => setSession(null))
      .finally(() => setRestoring(false))
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
    try {
      if (user) localStorage.removeItem(`medicue.view.${user.email}`) // the next sign-in starts at the home page
    } catch {}
    api.logout().catch(() => undefined) // revokes the refresh token and clears the cookie
    setSession(null)
    setUser(null)
  }

  return (
    <>
      <Toasts />
      {restoring ? (
        <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>
      ) : user ? (
        <Shell key={user.email} user={user} onLogout={signOut} />
      ) : (
        <AuthPage onLogin={setUser} />
      )}
    </>
  )
}
