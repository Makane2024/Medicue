import { useState, type ChangeEvent } from 'react'

export type AuthMode = 'login' | 'signup' | 'confirm' | 'hospital' | 'newpass' | 'invite' | 'forgot'

/**
 * The text fields of all auth screens share one store, so values survive switching between
 * tabs and the confirm / new-password steps can reuse the email and password just entered.
 */
export function useAuthForm(initial: Record<string, string> = {}) {
  const [values, setValues] = useState<Record<string, string>>(initial)
  return {
    val: (key: string) => values[key] ?? '',
    set: (key: string) => (e: ChangeEvent<HTMLInputElement>) =>
      setValues((prev) => ({ ...prev, [key]: e.target.value })),
    patch: (next: Record<string, string>) => setValues((prev) => ({ ...prev, ...next })),
  }
}

export type AuthForm = ReturnType<typeof useAuthForm>
