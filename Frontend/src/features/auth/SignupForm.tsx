import { api, isE164, passwordProblem, toE164 } from '@/api'
import { Button, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import { Steps } from './Steps'
import type { AuthForm } from './useAuthForm'

export function SignupForm({ form, onDone }: { form: AuthForm; onDone: () => void }) {
  const { busy, run } = useAction()
  const { val } = form

  const submit = async () => {
    const problem = passwordProblem(val('password'))
    if (problem) return toast(problem, false)
    const phone = toE164(val('phone'))
    if (!isE164(phone)) return toast('Enter your phone with its country code, e.g. +237 670 11 22 33', false)
    if (!val('dateOfBirth')) return toast('Date of birth is required', false)

    const created = await run(
      () =>
        api.signup({
          firstName: val('firstName'),
          lastName: val('lastName'),
          email: val('email'),
          password: val('password'),
          phone,
          dateOfBirth: val('dateOfBirth'),
        }),
      'Verification code sent to your email',
    )
    if (created) onDone()
  }

  return (
    <div className="space-y-4">
      <Steps at={0} />
      <div className="pb-2">
        <h2 className="text-3xl font-extrabold tracking-tight">Create your account</h2>
        <p className="mt-1 text-sm text-muted">It takes a minute. We'll email you a code.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" value={val('firstName')} onChange={form.set('firstName')} />
        <Field label="Last name" value={val('lastName')} onChange={form.set('lastName')} />
      </div>
      <Field label="Email" type="email" value={val('email')} onChange={form.set('email')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" placeholder="+237 670 11 22 33" value={val('phone')} onChange={form.set('phone')} />
        <Field label="Date of birth" type="date" value={val('dateOfBirth')} onChange={form.set('dateOfBirth')} />
      </div>
      <Field label="Password" type="password" value={val('password')} onChange={form.set('password')} />
      <p className="-mt-2 text-[11px] text-muted">
        At least 8 characters with an upper-case letter, a lower-case letter and a digit.
      </p>
      <Button
        className="w-full !h-12"
        disabled={busy || !val('email') || !val('firstName') || !val('lastName')}
        onClick={submit}
      >
        Create account
      </Button>
    </div>
  )
}
