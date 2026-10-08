import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { User } from '@/api'
import { AmbientBackground, Card } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { ConfirmForm } from './ConfirmForm'
import { HeroPanel } from './HeroPanel'
import { ForgotForm } from './ForgotForm'
import { HospitalForm } from './HospitalForm'
import { InviteForm } from './InviteForm'
import { consumeInvite } from './invite'
import { LoginForm } from './LoginForm'
import { NewPasswordForm } from './NewPasswordForm'
import { SignupForm } from './SignupForm'
import { useAuthForm, type AuthMode } from './useAuthForm'
import { useSignIn } from './useSignIn'

const TABS: [AuthMode, string][] = [
  ['login', 'Sign in'],
  ['signup', 'Patient sign up'],
  ['hospital', 'Register hospital'],
]

export function AuthPage({ onLogin }: { onLogin: (user: User) => void }) {
  // a doctor arriving from the invitation email lands on the set-password screen with the link's values filled in
  const [invite] = useState(consumeInvite)
  const [mode, setMode] = useState<AuthMode>(invite ? 'invite' : 'login')
  const [challenge, setChallenge] = useState('')
  const form = useAuthForm(invite ? { email: invite.email, password: invite.tempPassword } : {})

  const { busy, signIn } = useSignIn({
    onLogin,
    onChallenge: (session, email, password) => {
      setChallenge(session)
      form.patch({ email, password, newPassword: '', confirmPassword: '' })
      setMode('newpass')
    },
  })

  // sign-up and hospital registration both end with the emailed verification code
  const toConfirm = () => setMode('confirm')

  return (
    <div className="min-h-screen p-4 lg:p-8">
      <AmbientBackground />
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.05fr_1fr] lg:gap-6">
        <HeroPanel />

        <Card className="flex flex-col p-7 lg:p-10">
          {!['newpass', 'invite', 'forgot'].includes(mode) && (
            <div className="mb-10 flex gap-1 rounded-full bg-mist p-1 text-sm font-semibold">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={cx(
                    'h-10 flex-1 rounded-full transition',
                    mode === key || (key === 'signup' && mode === 'confirm')
                      ? 'bg-brand text-white'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {mode === 'login' && <LoginForm form={form} busy={busy} signIn={signIn} onForgot={() => setMode('forgot')} />}
          {mode === 'forgot' && <ForgotForm form={form} onDone={() => setMode('login')} />}
          {mode === 'signup' && <SignupForm form={form} onDone={toConfirm} />}
          {mode === 'confirm' && <ConfirmForm form={form} signIn={signIn} />}
          {mode === 'hospital' && <HospitalForm form={form} onDone={toConfirm} />}
          {mode === 'invite' && <InviteForm form={form} onLogin={onLogin} onBack={() => setMode('login')} />}
          {mode === 'newpass' && (
            <NewPasswordForm form={form} session={challenge} onLogin={onLogin} onBack={() => setMode('login')} />
          )}

          <div className="mt-auto flex items-center gap-2 pt-8 text-[11px] text-muted">
            <Lock className="size-3.5" />
            Secured by Amazon Cognito · Your medical notes stay private
          </div>
        </Card>
      </div>
    </div>
  )
}
