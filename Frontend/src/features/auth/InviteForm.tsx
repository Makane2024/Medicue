import { MailOpen } from 'lucide-react'
import { api, ApiError, passwordProblem, type User } from '@/api'
import { Button, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import type { AuthForm } from './useAuthForm'
import { enterApp } from './useSignIn'

interface Props {
  form: AuthForm
  onLogin: (user: User) => void
  onBack: () => void
}

/**
 * Landing page of the invitation link (doctors, staff and patients whose account was created for them). The email and temporary password arrive filled in (and stay
 * editable in case the link was only partly usable); the doctor just chooses a password. One submit signs in
 * with the temporary password and answers the "choose a new password" challenge, so the short-lived Cognito
 * session never has to survive while the doctor types.
 */
export function InviteForm({ form, onLogin, onBack }: Props) {
  const { busy, run } = useAction()
  const { val } = form

  const submit = async () => {
    const email = val('email').trim()
    if (!email || !val('password'))
      return toast('Enter your email and the temporary password from the invitation', false)
    const problem = passwordProblem(val('newPassword'))
    if (problem) return toast(problem, false)
    if (val('newPassword') !== val('confirmPassword')) return toast('The two passwords do not match', false)
    await run(async () => {
      let session: string
      try {
        const first = await api.login(email, val('password'))
        if (first.kind !== 'challenge') throw new Error('This invitation was already used. Sign in with your password.')
        session = first.session
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          throw new Error(
            'This invitation is no longer valid. It may have been used already or expired. Sign in with your password, or ask your hospital to invite you again.',
          )
        throw e
      }
      onLogin(await enterApp(await api.newPassword(email, val('newPassword'), session)))
    }, 'Password set. Welcome to MediCue')
  }

  return (
    <div className="space-y-4">
      <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft/60 text-brand">
        <MailOpen />
      </div>
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Welcome to MediCue</h2>
        <p className="mt-1 text-sm text-muted">
          An account was created for you on MediCue. Choose a password to finish; you'll be signed in right away.
        </p>
      </div>
      <Field label="Email" type="email" value={val('email')} onChange={form.set('email')} />
      <Field
        label="Temporary password"
        type="password"
        value={val('password')}
        onChange={form.set('password')}
        autoComplete="off"
      />
      <Field
        label="New password"
        type="password"
        value={val('newPassword')}
        onChange={form.set('newPassword')}
        autoComplete="new-password"
      />
      <Field
        label="Confirm new password"
        type="password"
        value={val('confirmPassword')}
        onChange={form.set('confirmPassword')}
        autoComplete="new-password"
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <p className="-mt-2 text-[11px] text-muted">
        At least 8 characters with an upper-case letter, a lower-case letter and a digit.
      </p>
      <Button className="w-full !h-12" disabled={busy || !val('newPassword')} onClick={submit}>
        Save password & sign in
      </Button>
      <button onClick={onBack} className="w-full text-xs font-semibold text-muted hover:text-ink">
        Back to sign in
      </button>
    </div>
  )
}
