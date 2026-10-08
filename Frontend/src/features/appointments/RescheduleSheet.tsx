import { useState } from 'react'
import { X } from 'lucide-react'
import { api, type Appointment, type Slot } from '@/api'
import { Button, Card, Empty } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { displayName, fmtFull, fmtTime } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import type { Dir } from '@/state/directory'

export function RescheduleSheet({
  a,
  dir,
  onClose,
  onDone,
}: {
  a: Appointment
  dir: Dir
  onClose: () => void
  onDone: () => void
}) {
  const [slots] = useLoad(() => api.browse(a.hospitalId))
  const [pick, setPick] = useState<Slot | null>(null)
  const { busy, run } = useAction()
  const general = a.consultationType === 'GENERAL'
  // the backend only moves an appointment to a slot of the same consultation type (same fee);
  // a specialist appointment stays with the same doctor, a general one takes any free general slot at that time
  const opts = (slots ?? [])
    .filter(
      (s) =>
        s.consultationType === a.consultationType && s.slotId !== a.slotId && (general || s.doctorId === a.doctorId),
    )
    .filter((s, i, arr) => !general || arr.findIndex((x) => x.startTime === s.startTime) === i)
    .slice(0, 12)
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 backdrop-blur-sm sm:place-items-center">
      <Card className="w-full max-w-lg p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">
            {general ? 'Reschedule general consultation' : `Reschedule with ${displayName(dir.user(a.doctorId))}`}
          </h3>
          <button onClick={onClose}>
            <X className="size-5 text-muted" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          A new confirmed appointment is created and the old one is kept as RESCHEDULED.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {opts.map((s) => (
            <button
              key={s.slotId}
              onClick={() => setPick(s)}
              className={cx(
                'rounded-2xl p-3 text-left text-xs transition',
                pick?.slotId === s.slotId ? 'bg-brand text-white' : 'bg-mist hover:bg-brand-soft/60',
              )}
            >
              <div className="font-bold">{fmtFull(s.startTime)}</div>
              <div className="opacity-80">{fmtTime(s.startTime)}</div>
            </button>
          ))}
        </div>
        {slots && !opts.length && <Empty>No other open slots of this kind.</Empty>}
        <Button
          className="mt-5 w-full"
          disabled={!pick || busy}
          onClick={async () => {
            if (await run(() => api.reschedule(a.appointmentId, pick!), 'Rescheduled')) onDone()
          }}
        >
          Confirm new time
        </Button>
      </Card>
    </div>
  )
}
