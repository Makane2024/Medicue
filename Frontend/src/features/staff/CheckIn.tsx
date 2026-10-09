import { useEffect, useState } from 'react'
import { Clock, DoorOpen, RefreshCcw, Search, UserCheck } from 'lucide-react'
import { api, type Appointment, CHECK_IN_EARLY_H } from '@/api'
import { Avatar, Badge, Button, Card, Empty, SectionHead } from '@/components/ui'
import { apptRef, displayName, fmtTime, sameDay } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { type Dir, loadAppointments } from '@/state/directory'

const REFRESH_MS = 30_000

/**
 * Reception desk, for any staff member (and the hospital admin): when a patient walks in and signs in, their
 * appointment becomes ARRIVED and the doctor sees them waiting. The doctor completes the session afterwards.
 */
export function CheckIn({ dir }: { dir: Dir }) {
  const [appts, reload] = useLoad(loadAppointments)
  const { busy, run } = useAction()
  const [query, setQuery] = useState('')

  // new bookings, cancellations and arrivals at other desks show up without a manual refresh
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS)
    return () => clearInterval(timer)
  }, [reload])

  const today = new Date()
  const match = (a: Appointment) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      displayName(dir.user(a.patientId)).toLowerCase().includes(q) ||
      displayName(dir.user(a.doctorId)).toLowerCase().includes(q) ||
      apptRef(a.appointmentId).toLowerCase().includes(q)
    )
  }
  const now = Date.now()
  const expected = (appts ?? [])
    .filter(
      (a) =>
        a.status === 'CONFIRMED' && +new Date(a.endTime) > now && sameDay(new Date(a.startTime), today) && match(a),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const waiting = (appts ?? [])
    .filter((a) => a.status === 'ARRIVED' && match(a))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const done = (appts ?? [])
    .filter((a) => a.status === 'COMPLETED' && sameDay(new Date(a.startTime), today) && match(a))
    .sort((a, b) => b.startTime.localeCompare(a.startTime))

  const arrive = async (a: Appointment) => {
    if (await run(() => api.checkIn(a.appointmentId), `${displayName(dir.user(a.patientId))} checked in`)) reload()
  }

  return (
    <div className="space-y-6">
      <section className="relative isolate overflow-hidden rounded-[32px] bg-brand p-6 text-white sm:p-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--c-brand)_50%,white)_0%,transparent_55%),radial-gradient(90%_80%_at_0%_100%,var(--c-brand-deep)_0%,transparent_70%)]" />
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-extrabold tracking-tight">Patient check-in</h2>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              When a patient arrives and signs in at the desk, mark them as arrived. The doctor is then told they are
              waiting. Check-in opens {CHECK_IN_EARLY_H} hours before the appointment.
            </p>
          </div>
          <div className="flex gap-3 text-center">
            <div className="rounded-2xl bg-white/15 px-5 py-3 backdrop-blur">
              <div className="text-2xl font-extrabold tabular-nums">{expected.length}</div>
              <div className="text-[11px] text-white/70">Expected</div>
            </div>
            <div className="rounded-2xl bg-white/15 px-5 py-3 backdrop-blur">
              <div className="text-2xl font-extrabold tabular-nums">{waiting.length}</div>
              <div className="text-[11px] text-white/70">Waiting</div>
            </div>
          </div>
        </div>
        <label className="relative mt-5 block">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by patient, doctor or reference (APT-…)"
            className="h-12 w-full rounded-full bg-surface pl-11 pr-4 text-sm text-ink outline-none ring-white/40 placeholder:text-muted focus:ring-4"
          />
        </label>
      </section>

      <section>
        <SectionHead
          title="Expected today"
          aside={
            <Button variant="ghost" className="!h-9 !px-3 text-xs" onClick={reload}>
              <RefreshCcw className="size-3.5" />
              Refresh
            </Button>
          }
        />
        <div className="space-y-3">
          {expected.map((a) => {
            const opensAt = +new Date(a.startTime) - CHECK_IN_EARLY_H * 36e5
            const early = opensAt > now
            return (
              <Card key={a.appointmentId} className="flex flex-wrap items-center gap-4 p-4 !rounded-[24px]">
                <Avatar u={dir.user(a.patientId)} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{displayName(dir.user(a.patientId))}</div>
                  <div className="text-xs text-muted">
                    {fmtTime(a.startTime)} – {fmtTime(a.endTime)} · with {displayName(dir.user(a.doctorId))}
                  </div>
                </div>
                <span className="rounded-full bg-mist px-3 py-1 font-mono text-[11px] font-semibold text-muted">
                  {apptRef(a.appointmentId)}
                </span>
                {early ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Clock className="size-3.5" />
                    Opens at {fmtTime(new Date(opensAt).toISOString())}
                  </span>
                ) : (
                  <Button className="!h-10" disabled={busy} onClick={() => arrive(a)}>
                    <DoorOpen className="size-4" />
                    Patient arrived
                  </Button>
                )}
              </Card>
            )
          })}
          {appts && !expected.length && (
            <Empty>{query ? 'No expected patient matches your search.' : 'Nobody else is expected today.'}</Empty>
          )}
        </div>
      </section>

      {waiting.length > 0 && (
        <section>
          <SectionHead title="Checked in · waiting for the doctor" />
          <Card className="divide-y divide-ink/5 p-2">
            {waiting.map((a) => (
              <div key={a.appointmentId} className="flex items-center gap-3 p-3">
                <Avatar u={dir.user(a.patientId)} size="size-10" />
                <div className="flex-1 text-sm">
                  <b>{displayName(dir.user(a.patientId))}</b>
                  <span className="block text-xs text-muted">
                    {fmtTime(a.startTime)} · {displayName(dir.user(a.doctorId))}
                  </span>
                </div>
                <Badge s="ARRIVED" />
              </div>
            ))}
          </Card>
        </section>
      )}

      {done.length > 0 && (
        <section>
          <SectionHead title="Completed today" />
          <Card className="divide-y divide-ink/5 p-2">
            {done.slice(0, 8).map((a) => (
              <div key={a.appointmentId} className="flex items-center gap-3 p-3">
                <UserCheck className="size-4 text-emerald-500" />
                <div className="flex-1 text-sm">
                  <b>{displayName(dir.user(a.patientId))}</b>
                  <span className="block text-xs text-muted">
                    {fmtTime(a.startTime)} · {displayName(dir.user(a.doctorId))}
                  </span>
                </div>
                <Badge s="COMPLETED" />
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  )
}
