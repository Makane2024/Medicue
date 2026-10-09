import { ArrowRight } from 'lucide-react'
import heroImage from '@/assets/hero-doctors.png'
import { Button, Field } from '@/components/ui'
import type { AuthForm } from './useAuthForm'

// Where each doctor's face sits in the photo, so three small round crops can be cut from it (background-position).
const DOCTOR_CROPS = ['5% 12%', '44% 24%', '91% 12%']

interface Props {
  form: AuthForm
  busy: boolean
  signIn: (email: string, password: string) => Promise<void>
  onForgot: () => void
}

export function LoginForm({ form, busy, signIn, onForgot }: Props) {
  const submit = () => signIn(form.val('email'), form.val('password'))

  return (
    <div className="space-y-4">
      <div className="flex -space-x-3 pb-1" aria-hidden>
        {DOCTOR_CROPS.map((position) => (
          <span
            key={position}
            className="size-14 rounded-full bg-no-repeat ring-4 ring-surface"
            style={{ backgroundImage: `url(${heroImage})`, backgroundSize: '320% auto', backgroundPosition: position }}
          />
        ))}
      </div>
      <div className="pb-2">
        <h2 className="text-3xl font-extrabold tracking-tight">Welcome back</h2>
        <p className="mt-1 text-sm text-muted">
          Sign in to manage your visits. Spend less time planning and more time taking care of yourself.
        </p>
      </div>
      <Field
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={form.val('email')}
        onChange={form.set('email')}
      />
      <Field
        label="Password"
        type="password"
        placeholder="••••••••"
        value={form.val('password')}
        onChange={form.set('password')}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <Button className="w-full !h-11" disabled={busy} onClick={submit}>
        Sign in
        <ArrowRight className="size-4" />
      </Button>
      <div className="text-center">
        <button type="button" onClick={onForgot} className="text-xs font-semibold text-brand hover:text-brand-deep">
          Forgot password?
        </button>
      </div>

    </div>
  )
}
