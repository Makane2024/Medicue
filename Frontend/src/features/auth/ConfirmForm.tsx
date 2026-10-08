import { Mail } from 'lucide-react'
import { api } from '@/api'
import { Button, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { Steps } from './Steps'
import type { AuthForm } from './useAuthForm'

interface Props {
  form: AuthForm
  signIn: (email: string, password: string) => Promise<void>
}

/** Email verification for patients and hospital admins; signs the user in once the code is accepted. */
export function ConfirmForm({ form, signIn }: Props) {
  const { busy, run } = useAction()
  const { val } = form

  const confirm = async () => {
    if (await run(() => api.confirm(val('email'), val('code')), 'Email verified')) signIn(val('email'), val('password'))
  }

  return (
    <div className="space-y-4">
      <Steps at={1} />
      <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft/60 text-brand">
        <Mail />
      </div>
      <h2 className="text-2xl font-bold">Check your inbox</h2>
      <p className="text-sm text-muted">
        We sent a 6-digit code to <b className="text-ink">{val('email')}</b>.
      </p>
      <Field
        label="Verification code"
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        className="tracking-[0.5em]"
        value={val('code')}
        onChange={form.set('code')}
      />
      <Button className="w-full !h-12" disabled={busy || val('code').length < 6} onClick={confirm}>
        Verify & sign in
      </Button>
    </div>
  )
}
