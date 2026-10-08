import { Lock } from 'lucide-react'
import { api, passwordProblem, type User } from '@/api'
import { Button, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import type { AuthForm } from './useAuthForm'
import { enterApp } from './useSignIn'

interface Props {
  form: AuthForm
  /** Cognito session returned by the NEW_PASSWORD_REQUIRED challenge. */
  session: string
  onLogin: (user: User) => void
  onBack: () => void
}

/** First sign-in of an account created by a hospital admin (a doctor): swap the temporary password for their own. */
export function NewPasswordForm({ form, session, onLogin, onBack }: Props) {
  const { busy, run } = useAction()
  const { val } = form

  const submit = async () => {
    const problem = passwordProblem(val('newPassword'))
    if (problem) return toast(problem, false)
    if (val('newPassword') !== val('confirmPassword')) return toast('The two passwords do not match', false)
    await run(
      async () => onLogin(await enterApp(await api.newPassword(val('email'), val('newPassword'), session))),
      'Password set. Welcome to MediCue',
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft/60 text-brand">
        <Lock />
      </div>
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Choose your password</h2>
        <p className="mt-1 text-sm text-muted">
          This is your first sign-in. You used the temporary password from your invitation email, so pick a password of
          your own for <b className="text-ink">{val('email')}</b>.
        </p>
      </div>
      <Field label="New password" type="password" value={val('newPassword')} onChange={form.set('newPassword')} />
      <Field
        label="Confirm new password"
        type="password"
        value={val('confirmPassword')}
        onChange={form.set('confirmPassword')}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <p className="-mt-2 text-[11px] text-muted">
        At least 8 characters with an upper-case letter, a lower-case letter and a digit.
      </p>
      <Button className="w-full !h-12" disabled={busy || !val('newPassword')} onClick={submit}>
        Save password & continue
      </Button>
      <button onClick={onBack} className="w-full text-xs font-semibold text-muted hover:text-ink">
        Back to sign in
      </button>
    </div>
  )
}
