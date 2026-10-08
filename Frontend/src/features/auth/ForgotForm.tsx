import { useState } from 'react'
import { KeyRound, MailCheck } from 'lucide-react'
import { api, passwordProblem } from '@/api'
import { Button, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import type { AuthForm } from './useAuthForm'

interface Props {
  form: AuthForm
  /** Back to the sign-in form; `email` is filled in there after a successful reset. */
  onDone: () => void
}

/** "I forgot my password": 1. we email a code, 2. the code and a new password. */
export function ForgotForm({ form, onDone }: Props) {
  const [sent, setSent] = useState(false)
  const { busy, run } = useAction()
  const { val } = form

  const sendCode = async () => {
    if (!val('email').trim()) return toast('Enter the email address of your account', false)
    if (await run(() => api.forgotPassword(val('email')))) {
      setSent(true)
      toast('If that account exists, a code is on its way', true)
    }
  }

  const reset = async () => {
    const problem = passwordProblem(val('newPassword'))
    if (problem) return toast(problem, false)
    if (val('newPassword') !== val('confirmPassword')) return toast('The two passwords do not match', false)
    if (
      await run(
        () => api.resetPassword(val('email'), val('code'), val('newPassword')),
        'Password changed. Sign in with your new password.',
      )
    ) {
      form.patch({ password: '', code: '', newPassword: '', confirmPassword: '' })
      onDone()
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft/60 text-brand">
        {sent ? <MailCheck /> : <KeyRound />}
      </div>
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">
          {sent ? 'Check your email' : 'Forgot your password?'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {sent ? (
            <>
              If an account exists for <b className="text-ink">{val('email')}</b>, we sent it a 6-digit code. Enter it
              with your new password.
            </>
          ) : (
            "Enter your email address and we'll send you a code to choose a new password."
          )}
        </p>
      </div>

      {!sent ? (
        <>
          <Field
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={val('email')}
            onChange={form.set('email')}
            onKeyDown={(e) => e.key === 'Enter' && sendCode()}
          />
          <Button className="w-full !h-12" disabled={busy} onClick={sendCode}>
            Send me a code
          </Button>
        </>
      ) : (
        <>
          <Field
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={val('code')}
            onChange={form.set('code')}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={val('newPassword')}
            onChange={form.set('newPassword')}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={val('confirmPassword')}
            onChange={form.set('confirmPassword')}
            onKeyDown={(e) => e.key === 'Enter' && reset()}
          />
          <p className="-mt-2 text-[11px] text-muted">
            At least 8 characters with an upper-case letter, a lower-case letter and a digit.
          </p>
          <Button className="w-full !h-12" disabled={busy || !val('code') || !val('newPassword')} onClick={reset}>
            Change password
          </Button>
          <button onClick={sendCode} disabled={busy} className="w-full text-xs font-semibold text-muted hover:text-ink">
            Send the code again
          </button>
        </>
      )}
      <button onClick={onDone} className="w-full text-xs font-semibold text-muted hover:text-ink">
        Back to sign in
      </button>
    </div>
  )
}
