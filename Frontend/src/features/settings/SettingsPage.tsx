import { useState, type ReactNode } from 'react'
import {
  Bell,
  Building2,
  Info,
  KeyRound,
  LogOut,
  Palette,
  RefreshCcw,
  ShieldCheck,
  Type,
  UserRound,
} from 'lucide-react'
import type { User } from '@/api'
import { Avatar, Button, Card, Segmented, Switch } from '@/components/ui'
import { ROLE_LABEL } from '@/features/shell/nav'
import { cx } from '@/lib/classNames'
import { DEFAULT_PREFS, setPrefs, usePrefs } from '@/lib/preferences'
import { ChangePasswordSheet } from './ChangePasswordSheet'
import { AccentSwatches, ThemeTiles } from './ThemeTiles'

export { ACCENTS } from './ThemeTiles'

/** A card with a tinted icon tile and a title, the pattern of every block on this page. */
function Block({
  icon,
  title,
  hint,
  children,
  className,
}: {
  icon: ReactNode
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cx('p-5 sm:p-6', className)}>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft/60 text-brand">{icon}</span>
        <div>
          <h3 className="text-base font-bold leading-tight">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </Card>
  )
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">{children}</div>
)

export function SettingsPage({ user, go, onLogout }: { user: User; go: (view: string) => void; onLogout: () => void }) {
  const p = usePrefs()
  const [changing, setChanging] = useState(false)
  const workplace = user.hospital

  return (
    <div className="space-y-5">
      <section className="relative isolate overflow-hidden rounded-[32px] bg-brand p-6 text-white sm:p-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--c-brand)_50%,white)_0%,transparent_55%),radial-gradient(90%_80%_at_0%_100%,var(--c-brand-deep)_0%,transparent_70%)]" />
        <div className="absolute inset-0 -z-10 opacity-[0.1] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom_right,black,transparent_70%)]" />
        <div className="flex flex-wrap items-center gap-4 sm:gap-5">
          <Avatar u={user} size="size-16 sm:size-20" />
          <div className="min-w-0 flex-1">
            <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">
              {ROLE_LABEL[user.role]}
            </span>
            <h2 className="mt-2 truncate text-2xl font-extrabold tracking-tight sm:text-3xl">
              {user.firstName} {user.lastName}
            </h2>
            <p className="truncate text-sm text-white/75">{user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="white" onClick={() => go('profile')}>
              <UserRound className="size-4" />
              Edit profile
            </Button>
            <Button variant="soft" className="!bg-white/15 !text-white hover:!bg-white/25" onClick={onLogout}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Block
            icon={<Palette className="size-5" />}
            title="Appearance"
            hint="Saved on this device and applied straight away."
          >
            <div className="space-y-6">
              <div>
                <Label>Theme</Label>
                <ThemeTiles />
              </div>
              <div>
                <Label>Accent colour</Label>
                <AccentSwatches />
              </div>
            </div>
          </Block>

          <Block icon={<Type className="size-5" />} title="Reading and motion" hint="Make the app easier on the eyes.">
            <div className="space-y-5">
              <div>
                <Label>Text size</Label>
                <Segmented
                  value={p.text}
                  onChange={(v) => setPrefs({ text: v })}
                  options={[
                    ['normal', 'Default', <Type key="a" className="size-3.5" />],
                    ['large', 'Larger', <Type key="b" className="size-5" />],
                  ]}
                />
              </div>
              <div className="divide-y divide-ink/5">
                <Switch
                  on={p.motion === 'reduce'}
                  onChange={(v) => setPrefs({ motion: v ? 'reduce' : 'full' })}
                  label="Reduce motion"
                  hint="Turns off animations and transitions"
                />
              </div>
            </div>
          </Block>
        </div>

        <div className="space-y-5">
          <Block icon={<Bell className="size-5" />} title="Notifications">
            {user.role === 'PATIENT' ? (
              <>
                <div className="divide-y divide-ink/5">
                  <Switch
                    on={p.emailAlerts}
                    onChange={(v) => setPrefs({ emailAlerts: v })}
                    label="Email reminder"
                    hint="About 48 hours before each appointment"
                  />
                  <Switch
                    on={p.smsAlerts}
                    onChange={(v) => setPrefs({ smsAlerts: v })}
                    label="SMS reminder"
                    hint="About 30 minutes before each appointment"
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Booking, payment, cancellation and waitlist messages are always sent.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                Important messages are emailed to <b className="text-ink">{user.email}</b> and listed under
                Notifications.
              </p>
            )}
          </Block>

          <Block icon={<ShieldCheck className="size-5" />} title="Security" hint="Keep your account safe.">
            <button
              onClick={() => setChanging(true)}
              className="flex w-full items-center gap-3 rounded-2xl bg-mist p-3 text-left transition hover:bg-brand-soft/50"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-surface text-brand">
                <KeyRound className="size-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">Change password</span>
                <span className="block text-xs text-muted">We email you a code to confirm it is you</span>
              </span>
            </button>
          </Block>

          {workplace && (
            <Block icon={<Building2 className="size-5" />} title="Workplace">
              <div className="rounded-2xl bg-mist p-3">
                <div className="text-sm font-bold">{workplace.name}</div>
                {workplace.address && <div className="text-xs text-muted">{workplace.address}</div>}
              </div>
            </Block>
          )}

          <Block icon={<Info className="size-5" />} title="About">
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">Signed in as</dt>
                <dd className="font-semibold">{ROLE_LABEL[user.role]}</dd>
              </div>
            </dl>
            <Button variant="ghost" className="mt-4 w-full" onClick={() => setPrefs(DEFAULT_PREFS)}>
              <RefreshCcw className="size-4" />
              Reset appearance to defaults
            </Button>
          </Block>
        </div>
      </div>

      {changing && <ChangePasswordSheet user={user} onClose={() => setChanging(false)} />}
    </div>
  )
}
