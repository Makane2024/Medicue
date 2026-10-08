import { useState } from 'react'
import { CheckCheck, FileText, RefreshCcw } from 'lucide-react'
import { api, type Appointment, type User } from '@/api'
import { ReportButton } from '@/components/ReportButton'
import { Button, Empty } from '@/components/ui'
import { ApptRow } from '@/features/appointments/ApptRow'
import { NotesSheet } from '@/features/appointments/NotesSheet'
import { RescheduleSheet } from '@/features/appointments/RescheduleSheet'
import { useAction, useLoad } from '@/lib/hooks'
import { type Dir, loadAppointments } from '@/state/directory'

export function DoctorAppts({ dir }: { dir: Dir; user: User }) {
  const [appts, reload] = useLoad(loadAppointments)
  const [notesFor, setNotesFor] = useState<Appointment | null>(null)
  const [resched, setResched] = useState<Appointment | null>(null)
  const { busy, run } = useAction()
  const list = (appts ?? [])
    .filter((a) => !['PENDING_PAYMENT', 'EXPIRED'].includes(a.status))
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        When a patient arrives, the hospital desk checks them in and they show here as arrived. Mark the session
        completed when the consultation is over, then write your notes. Only you and that patient can read them.
      </p>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((a) => (
          <ApptRow
            key={a.appointmentId}
            a={a}
            dir={dir}
            who="patient"
            showFee={false}
            actions={
              <>
                {a.status === 'ARRIVED' && (
                  <Button
                    className="!h-9 !px-4 text-xs"
                    disabled={busy}
                    onClick={async () => {
                      if (await run(() => api.completeAppointment(a.appointmentId), 'Session completed')) reload()
                    }}
                  >
                    <CheckCheck className="size-3.5" />
                    Complete session
                  </Button>
                )}
                {a.status === 'COMPLETED' && (
                  <Button className="!h-9 !px-4 text-xs" onClick={() => setNotesFor(a)}>
                    <FileText className="size-3.5" />
                    Session notes
                  </Button>
                )}
                {['CONFIRMED', 'MISSED'].includes(a.status) && (
                  <Button variant="soft" className="!h-9 !px-4 text-xs" onClick={() => setResched(a)}>
                    <RefreshCcw className="size-3.5" />
                    Reschedule
                  </Button>
                )}
                <ReportButton userId={a.patientId} label="Report patient" />
              </>
            }
          />
        ))}
        {appts && !list.length && <Empty>No appointments.</Empty>}
      </div>
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
      {notesFor && <NotesSheet a={notesFor} dir={dir} canWrite onClose={() => setNotesFor(null)} />}
    </div>
  )
}
