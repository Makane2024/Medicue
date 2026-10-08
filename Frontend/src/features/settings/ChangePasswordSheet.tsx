import { useState } from 'react'
import { api, passwordProblem, type User } from '@/api'
import { Button, Field, Modal } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'

/**
 * Changes the signed-in user's password. We email a code to their own address first, so a stranger at an unlocked
 * screen cannot change it: the same two steps as "forgot password".
 */
export function ChangePasswordSheet({ user, onClose }: { user: User; onClose: () => void }) {
  const [sent, setSent] = useState(false)
  const [f, setF] = useState({ code: '', newPassword: '', confirmPassword: '' })
  const { busy, run } = useAction()
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  const sendCode = async () => {
    if (await run(() => api.forgotPassword(user.email))) setSent(true)
  }

  const save = async () => {
    const problem = passwordProblem(f.newPassword)
    if (problem) return toast(problem, false)
    if (f.newPassword !== f.confirmPassword) return toast('The two passwords do not match', false)
    if (await run(() => api.resetPassword(user.email, f.code, f.newPassword), 'Password changed')) onClose()
  }

  return (
    <Modal title="Change your password" onClose={onClose}>
      <div className="mt-3 space-y-3">
        {!sent ? (
          <>
            <p className="text-sm text-muted">
              For your security we send a 6-digit code to <b className="text-ink">{user.email}</b>. You enter it here
              together with your new password.
            </p>
            <Button className="w-full" disabled={busy} onClick={sendCode}>
              Email me a code
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              We sent a code to <b className="text-ink">{user.email}</b>. It can take a minute to arrive.
            </p>
            <Field
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={f.code}
              onChange={set('code')}
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              value={f.newPassword}
              onChange={set('newPassword')}
            />
            <Field
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={f.confirmPassword}
              onChange={set('confirmPassword')}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <p className="-mt-1 text-[11px] text-muted">
              At least 8 characters with an upper-case letter, a lower-case letter and a digit.
            </p>
            <Button className="w-full" disabled={busy || !f.code || !f.newPassword} onClick={save}>
              Change password
            </Button>
            <button
              onClick={sendCode}
              disabled={busy}
              className="w-full text-xs font-semibold text-muted hover:text-ink"
            >
              Send the code again
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
