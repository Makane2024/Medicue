import { useState } from 'react'
import { Building2, Search, Sparkles } from 'lucide-react'
import { api, type ConsultationType, HOLD_MIN, type Slot, type User } from '@/api'
import { ArrowButton, Avatar, Card, CountUp, Empty, SectionHead } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { displayName, fmtFull } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { type Dir, loadAppointments } from '@/state/directory'
import { isWeekend } from './DayStrip'
import { DoctorProfile } from './DoctorProfile'
import { GeneralBooking } from './GeneralBooking'
import { UpcomingCard } from './UpcomingCard'

export function PatientHome({ dir, go }: { dir: Dir; go: (v: string) => void }) {
  const [pickedHospital, setHospitalId] = useState('')
  const hospitalId = pickedHospital || dir.hospitals[0]?.hospitalId || ''
  const [slots, reloadSlots] = useLoad(
    () => (hospitalId ? api.browse(hospitalId) : Promise.resolve([] as Slot[])),
    [hospitalId],
  )
  const [appts, reloadAppts] = useLoad(loadAppointments)
  const [mode, setMode] = useState<ConsultationType>('GENERAL')
  const [spec, setSpec] = useState('All')
  const [q, setQ] = useState('')
  const [doctor, setDoctor] = useState<string | null>(null)
  const { run } = useAction()

  const next = appts
    ?.filter((a) => a.status === 'CONFIRMED' && +new Date(a.startTime) > Date.now())
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
  // the backend lists every bookable slot of a hospital; the type, specialty and name filters run here
  const generalSlots = (slots ?? []).filter((s) => s.consultationType === 'GENERAL')
  const specialistSlots = (slots ?? []).filter(
    (s) => s.consultationType === 'SPECIALIST' && !isWeekend(new Date(s.startTime)),
  )
  const doctorIds = [...new Set(specialistSlots.map((s) => s.doctorId))]
  const specs = ['All', ...new Set(doctorIds.map((id) => dir.user(id)?.specialty).filter((s): s is string => !!s))]
  const list = doctorIds
    .map((id) => dir.user(id))
    .filter((u): u is User => !!u)
    .filter((u) => spec === 'All' || u.specialty === spec)
    .filter(
      (u) =>
        displayName(u).toLowerCase().includes(q.toLowerCase()) ||
        (u.specialty ?? '').toLowerCase().includes(q.toLowerCase()),
    )

  if (doctor)
    return (
      <DoctorProfile
        dir={dir}
        doctorId={doctor}
        slots={specialistSlots.filter((s) => s.doctorId === doctor)}
        back={() => {
          setDoctor(null)
          reloadSlots()
          reloadAppts()
        }}
        onBooked={() => go('appts')}
      />
    )

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5 min-w-0">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="grid flex-1 grid-cols-2 gap-1 rounded-full bg-surface p-1.5">
            {(
              [
                ['GENERAL', 'General consultation'],
                ['SPECIALIST', 'See a specialist'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={cx(
                  'h-11 rounded-full text-sm font-semibold transition',
                  mode === k ? 'bg-brand text-white' : 'text-muted hover:text-ink',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex h-14 items-center gap-2 rounded-full bg-surface pl-5 pr-3">
            <Building2 className="size-[18px] text-muted" />
            <select
              value={hospitalId}
              onChange={(e) => setHospitalId(e.target.value)}
              className="h-full bg-transparent text-sm font-semibold outline-none"
            >
              {dir.hospitals.map((h) => (
                <option key={h.hospitalId} value={h.hospitalId}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!dir.hospitals.length && <Empty>No hospital is open for booking yet. Please check back soon.</Empty>}

        {hospitalId &&
          (mode === 'GENERAL' ? (
            <div id="booking" className="scroll-mt-6">
              <GeneralBooking
                dir={dir}
                slots={generalSlots}
                onBooked={() => go('appts')}
                onWaitlist={() => go('waitlist')}
                reload={reloadSlots}
              />
            </div>
          ) : (
            <>
              <div className="flex h-14 items-center gap-3 rounded-full bg-surface px-5">
                <Search className="size-[18px] text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search specialists or specialties…"
                  className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {specs.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpec(s)}
                    className={cx(
                      'h-11 shrink-0 rounded-full px-6 text-sm font-semibold transition',
                      spec === s ? 'bg-brand text-white' : 'bg-surface text-ink hover:bg-brand-soft/50',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div id="booking" className="scroll-mt-6">
                <SectionHead
                  title="Specialists"
                  aside={<span className="text-xs text-muted">{list.length} with open slots</span>}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((u) => {
                    const n = specialistSlots.filter((s) => s.doctorId === u.userId)
                    return (
                      <Card
                        key={u.userId}
                        className="flex items-center gap-4 p-3 pr-4 !rounded-[24px] transition hover:-translate-y-0.5 hover:shadow-[0_24px_40px_-24px_rgba(42,82,196,0.55)]"
                      >
                        <Avatar u={u} size="size-14" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold">{displayName(u)}</div>
                          <div className="text-xs text-muted">{u.specialty}</div>
                          <div className="mt-1 text-[11px] font-semibold text-brand">
                            {n.length} slots · next {fmtFull(n[0].startTime)}
                          </div>
                        </div>
                        <ArrowButton onClick={() => setDoctor(u.userId)} />
                      </Card>
                    )
                  })}
                  {slots && !list.length && (
                    <div className="sm:col-span-2">
                      <Empty>
                        No open specialist slots match.{' '}
                        <button className="font-semibold text-brand" onClick={() => go('waitlist')}>
                          Join the waitlist →
                        </button>
                      </Empty>
                    </div>
                  )}
                </div>
              </div>
            </>
          ))}
      </div>

      <div className="space-y-5">
        <SectionHead
          title="Upcoming appointment"
          aside={
            <button onClick={() => go('appts')} className="text-xs font-semibold text-muted hover:text-brand">
              See all
            </button>
          }
        />
        {next ? (
          <UpcomingCard
            a={next}
            dir={dir}
            onCancel={async () => {
              if (await run(() => api.cancel(next.appointmentId), 'Appointment cancelled · slot released')) {
                reloadAppts()
                reloadSlots()
              }
            }}
            onDetails={() => go('appts')}
          />
        ) : (
          <Empty>No upcoming appointments yet.</Empty>
        )}
        <Card className="grid grid-cols-3 divide-x divide-ink/5 p-4 text-center">
          {[
            [appts?.filter((a) => a.status === 'COMPLETED').length ?? 0, 'Visits'],
            [appts?.filter((a) => a.status === 'CONFIRMED').length ?? 0, 'Upcoming'],
            [new Set(appts?.filter((a) => a.status === 'COMPLETED').map((a) => a.doctorId)).size, 'Doctors seen'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="text-2xl font-bold tabular-nums">
                <CountUp value={v as number} />
              </div>
              <div className="text-[11px] text-muted">{l}</div>
            </div>
          ))}
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold">
            <Sparkles className="size-4 text-brand" />
            How booking works
          </div>
          <ol className="relative space-y-4 before:absolute before:left-[13px] before:top-2 before:bottom-2 before:w-px before:bg-brand-soft">
            <span className="absolute left-[10px] z-20 size-2 rounded-full bg-brand shadow-[0_0_0_4px_color-mix(in_oklab,var(--c-brand)_20%,transparent)] animate-travel" />
            {[
              ['Pick a time', 'General visits are matched to any free doctor'],
              ['Pay within ' + HOLD_MIN + ' min', 'Your slot is held while you pay by MoMo'],
              ['Get reminders', 'Email 48h before, SMS 30 min before'],
              ['Read your notes', "Your doctor's notes stay private to you"],
            ].map(([t, d], i) => (
              <li key={t} className="relative flex gap-3">
                <span className="z-10 grid size-7 shrink-0 place-items-center rounded-full bg-surface text-xs font-bold text-brand ring-2 ring-brand-soft">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-semibold">{t}</div>
                  <div className="text-xs text-muted">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
