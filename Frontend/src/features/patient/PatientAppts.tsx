import { useState } from 'react'
import { Check, FileText, RefreshCcw, Smartphone, Star } from 'lucide-react'
import { api, type Appointment, HOLD_MIN, RESCHEDULE_CUTOFF_H } from '@/api'
import { Button, Empty, SectionHead } from '@/components/ui'
import { ApptRow } from '@/features/appointments/ApptRow'
import { NotesSheet } from '@/features/appointments/NotesSheet'
import { PaymentSheet } from '@/features/appointments/PaymentSheet'
import { RescheduleSheet } from '@/features/appointments/RescheduleSheet'
import { useAction, useLoad } from '@/lib/hooks'
import { type Dir, loadAppointments } from '@/state/directory'
import { ReviewSheet } from './ReviewSheet'

export function PatientAppts({ dir }: { dir: Dir }) {
  const [appts, reload] = useLoad(loadAppointments)
  const [myReviews, reloadReviews] = useLoad(api.myReviews)
  const [resched, setResched] = useState<Appointment | null>(null)
  const [notesFor, setNotesFor] = useState<Appointment | null>(null)
  const [reviewing, setReviewing] = useState<Appointment | null>(null)
  const [paying, setPaying] = useState<Appointment | null>(null)
  const { run } = useAction()
  const sorted = (appts ?? []).slice().sort((a, b) => b.startTime.localeCompare(a.startTime))
  const upcoming = sorted
    .filter(
      (a) =>
        (['CONFIRMED', 'PENDING_PAYMENT'].includes(a.status) && +new Date(a.endTime) > Date.now()) ||
        a.status === 'ARRIVED', // checked in at the hospital, waiting for the doctor
    )
    .reverse()
  const past = sorted.filter((a) => !upcoming.includes(a))
  // the backend only allows notes to be recorded and read once a session is COMPLETED
  const notesBtn = (a: Appointment) =>
    a.status === 'COMPLETED' && (
      <Button variant="soft" className="!h-9 !px-4 text-xs" onClick={() => setNotesFor(a)}>
        <FileText className="size-3.5" />
        Notes
      </Button>
    )
  return (
    <div className="space-y-6">
      <section>
        <SectionHead title="Upcoming" />
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {upcoming.map((a) => {
            const started = +new Date(a.startTime) <= Date.now()
            const within2h = +new Date(a.startTime) - Date.now() < RESCHEDULE_CUTOFF_H * 36e5
            const holdLeft = +new Date(a.createdAt) + HOLD_MIN * 6e4 > Date.now()
            return (
              <ApptRow
                key={a.appointmentId}
                a={a}
                dir={dir}
                actions={
                  a.status === 'ARRIVED' ? (
                    <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-300">
                      You are checked in. The doctor will see you shortly.
                    </span>
                  ) : a.status === 'PENDING_PAYMENT' ? (
                    holdLeft ? (
                      <Button className="!h-9 !px-4 text-xs" onClick={() => setPaying(a)}>
                        <Smartphone className="size-3.5" />
                        Pay now
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted">Payment window closed</span>
                    )
                  ) : (
                    <>
                      <Button
                        variant="soft"
                        className="!h-9 !px-4 text-xs"
                        disabled={within2h}
                        title={within2h ? `Cannot reschedule within ${RESCHEDULE_CUTOFF_H} hours` : ''}
                        onClick={() => setResched(a)}
                      >
                        <RefreshCcw className="size-3.5" />
                        Reschedule
                      </Button>
                      {!started && (
                        <Button
                          variant="danger"
                          className="!h-9 !px-4 text-xs"
                          onClick={async () => {
                            if (await run(() => api.cancel(a.appointmentId), 'Cancelled · slot released to waitlist'))
                              reload()
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                      {within2h && !started && (
                        <span className="text-[11px] text-muted">Within {RESCHEDULE_CUTOFF_H}h reschedule cutoff</span>
                      )}
                    </>
                  )
                }
              />
            )
          })}
          {appts && !upcoming.length && <Empty>No upcoming appointments.</Empty>}
        </div>
      </section>
      <section>
        <SectionHead title="History" />
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {past.map((a) => (
            <ApptRow
              key={a.appointmentId}
              a={a}
              dir={dir}
              actions={
                a.status === 'COMPLETED' && (
                  <>
                    {notesBtn(a)}
                    {myReviews && !myReviews.some((r) => r.appointmentId === a.appointmentId) ? (
                      <Button className="!h-9 !px-4 text-xs" onClick={() => setReviewing(a)}>
                        <Star className="size-3.5" />
                        Review doctor
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-muted">
                        <Check className="size-3.5 text-emerald-500" />
                        Reviewed
                      </span>
                    )}
                  </>
                )
              }
            />
          ))}
        </div>
      </section>
      {paying && (
        <PaymentSheet
          a={paying}
          dir={dir}
          onClose={() => {
            setPaying(null)
            reload()
          }}
          onPaid={() => {
            setPaying(null)
            reload()
          }}
        />
      )}
      {resched && (
        <RescheduleSheet
          a={resched}
          dir={dir}
          onClose={() => setResched(null)}
          onDone={() => {
            setResched(null)
            reload()
          }}
        />
      )}
      {notesFor && <NotesSheet a={notesFor} dir={dir} canWrite={false} onClose={() => setNotesFor(null)} />}
      {reviewing && (
        <ReviewSheet
          a={reviewing}
          dir={dir}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null)
            reloadReviews()
          }}
        />
      )}
    </div>
  )
}
