import { api, setSession, type User } from '@/api'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'

/** Tokens -> who am I (role, hospital) -> a ready session. A failed profile load leaves the user signed out. */
export async function enterApp(idToken: string): Promise<User> {
  setSession(idToken)
  try {
    const user = await api.me()
    setSession(idToken, user.userId)
    return user
  } catch (error) {
    setSession(null)
    throw error
  }
}

interface Options {
  onLogin: (user: User) => void
  /** A doctor's first sign-in must choose a new password before getting tokens. */
  onChallenge: (session: string, email: string, password: string) => void
}

export function useSignIn({ onLogin, onChallenge }: Options) {
  const { busy, run } = useAction()

  const signIn = async (email: string, password: string) => {
    if (!email || !password) return toast('Enter your email and password', false)
    await run(async () => {
      const result = await api.login(email, password)
      if (result.kind === 'challenge') return onChallenge(result.session, email, password)
      onLogin(await enterApp(result.idToken))
    })
  }

  return { busy, signIn }
}
