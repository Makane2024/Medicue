import { useState } from 'react'
import {
  CalendarCheck,
  Clock3,
  FileSpreadsheet,
  MailCheck,
  Plus,
  Search,
  Stethoscope,
  UserPlus,
  Users,
} from 'lucide-react'
import { api, type Review, type Slot, type User } from '@/api'
import { Card, Empty } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { displayName } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { asUser } from '@/state/directory'
import { AddDoctorForm } from './AddDoctorForm'
import { DoctorCard, type DoctorFigures } from './DoctorCard'

const STEPS = [
  { icon: UserPlus, title: 'Add the doctor', text: 'Name, email and specialty. Or import many at once from Excel.' },
  {
    icon: MailCheck,
    title: 'They get an invitation',
    text: 'An emailed link lets them choose a password and sign in.',
  },
  {
    icon: CalendarCheck,
    title: 'Propose availability',
    text: 'You choose the times; the doctor approves them before patients can book.',
  },
]

const figuresOf = (slots: Slot[]): DoctorFigures => {
  const now = Date.now()
  const future = slots.filter((s) => +new Date(s.startTime) > now)
  const live = future.filter((s) => ['APPROVED', 'BOOKED', 'OFFERED'].includes(s.status))
  return {
    open: future.filter((s) => s.status === 'APPROVED').length,
    booked: future.filter((s) => ['BOOKED', 'OFFERED'].includes(s.status)).length,
    pending: future.filter((s) => s.status === 'PENDING').length,
    next: live.map((s) => s.startTime).sort()[0],
  }
}

export function HospitalDoctors({ user, go }: { user: User; go: (view: string) => void }) {
  const [docs, reload] = useLoad(() => api.doctors(user.hospitalId!))
  const [slots] = useLoad(() => api.hospitalSlots())
  const [reviews] = useLoad(async () => {
    const list = await api.doctors(user.hospitalId!)
    const out: Record<string, Review[]> = {}
    await Promise.all(list.map(async (d) => (out[d.doctorId] = await api.doctorReviews(d.doctorId).catch(() => []))))
    return out
  })
  const { busy, run } = useAction()
  const [query, setQuery] = useState('')
  const [specialty, setSpecialty] = useState('All')

  const all = docs ?? []
  const specialties = [...new Set(all.map((d) => d.specialty))].sort()
  const shown = all.filter(
    (d) =>
      (specialty === 'All' || d.specialty === specialty) &&
      `${displayName(asUser(d))} ${d.specialty}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const figures = new Map(
    all.map((d) => [d.doctorId, figuresOf((slots ?? []).filter((s) => s.doctorId === d.doctorId))]),
  )
  const total = (k: keyof DoctorFigures) => [...figures.values()].reduce((n, f) => n + (Number(f[k]) || 0), 0)

  const tiles = [
    { label: 'Doctors', value: all.length, icon: Users },
    { label: 'Specialties', value: specialties.length, icon: Stethoscope },
    { label: 'Open slots', value: total('open'), icon: CalendarCheck },
    { label: 'Awaiting approval', value: total('pending'), icon: Clock3 },
  ]

  const remove = async (id: string) => {
    const d = all.find((x) => x.doctorId === id)!
    if (
      !confirm(
        `Remove ${displayName(asUser(d))} from your hospital? Their pending and open slots here will be deleted. Doctors with upcoming bookings can't be removed.`,
      )
    )
      return
    if (await run(() => api.removeDoctor(id), 'Doctor removed')) reload()
  }

  return (
    <div className="space-y-5">
      <section className="relative isolate overflow-hidden rounded-[32px] bg-brand p-6 text-white sm:p-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--c-brand)_50%,white)_0%,transparent_55%),radial-gradient(90%_80%_at_0%_100%,var(--c-brand-deep)_0%,transparent_70%)]" />
        <div className="absolute inset-0 -z-10 opacity-[0.1] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom_right,black,transparent_70%)]" />
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">
              {user.hospital?.name ?? 'Your hospital'}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Your doctors</h2>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              The people who see patients at your hospital, and how full their calendars are.
            </p>
          </div>
          <label className="relative block w-full sm:w-80">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or specialty"
              className="h-12 w-full rounded-full bg-surface pl-11 pr-4 text-sm text-ink outline-none ring-white/40 placeholder:text-muted focus:ring-4"
            />
          </label>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[22px] bg-white/20 backdrop-blur lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="bg-white/10 p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70">
                <t.icon className="size-3.5" />
                {t.label}
              </div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{docs ? t.value : '–'}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          {specialties.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {['All', ...specialties].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpecialty(s)}
                  className={cx(
                    'h-9 rounded-full px-4 text-xs font-bold transition',
                    specialty === s ? 'bg-brand text-white shadow' : 'bg-surface text-muted hover:text-ink',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((d) => (
              <DoctorCard
                key={d.doctorId}
                doctor={d}
                figures={figures.get(d.doctorId)!}
                reviews={reviews?.[d.doctorId] ?? []}
                busy={busy}
                onRemove={() => remove(d.doctorId)}
                onPropose={() => go('propose')}
              />
            ))}
            {docs && !query && specialty === 'All' && (
              <button
                onClick={() => document.getElementById('add-doctor-first')?.focus()}
                className="grid min-h-60 place-items-center rounded-[26px] border-2 border-dashed border-ink/15 p-6 text-center transition hover:border-brand/60 hover:bg-brand-soft/20"
              >
                <span>
                  <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-brand-soft/60 text-brand">
                    <Plus className="size-6" />
                  </span>
                  <span className="block font-bold">Add {all.length ? 'another' : 'your first'} doctor</span>
                  <span className="mt-1 block text-xs text-muted">
                    Fill in the form, or import a whole team from Excel
                  </span>
                </span>
              </button>
            )}
          </div>
          {docs && all.length > 0 && !shown.length && <Empty>No doctor matches your search.</Empty>}

          {docs && !all.length && (
            <Card className="p-6">
              <h3 className="text-lg font-bold">Get your hospital ready for patients</h3>
              <p className="mt-1 text-sm text-muted">Three steps and patients can start booking.</p>
              <ol className="mt-5 grid gap-4 md:grid-cols-3">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="rounded-3xl bg-mist p-4">
                    <span className="grid size-10 place-items-center rounded-2xl bg-surface text-brand">
                      <s.icon className="size-5" />
                    </span>
                    <div className="mt-3 text-sm font-bold">
                      {i + 1}. {s.title}
                    </div>
                    <div className="mt-1 text-xs text-muted">{s.text}</div>
                  </li>
                ))}
              </ol>
              <div className="mt-5 flex items-center gap-2 text-xs text-muted">
                <FileSpreadsheet className="size-4 text-brand" />
                Have a long list? Use <b className="text-ink">Import accounts</b> in the menu.
              </div>
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-5 lg:self-start">
          <AddDoctorForm user={user} onAdded={reload} />
        </div>
      </div>
    </div>
  )
}
