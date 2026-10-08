import { useMemo, useState } from 'react'
import { Stethoscope } from 'lucide-react'
import { api, type Appointment, FEES, type Slot } from '@/api'
import { Button, Card, SectionHead } from '@/components/ui'
import { PaymentSheet } from '@/features/appointments/PaymentSheet'
import { cx } from '@/lib/classNames'
import { displayName, fmtFull, fmtTime, sameDay } from '@/lib/format'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import type { Dir } from '@/state/directory'
import { DayStrip, isPastDay, nextDays } from './DayStrip'

// General consultations: the patient picks a time; every general slot at that time belongs to a different
// general practitioner, so we book the first one that is still free (the next one if it was just taken).
export function GeneralBooking({
  dir,
  slots,
  onBooked,
  onWaitlist,
  reload,
}: {
  dir: Dir
  slots: Slot[]
  onBooked: () => void
  onWaitlist: () => void
  reload: () => void
}) {
  const days = useMemo(nextDays, [])
  const [day, setDay] = useState(days[0])
  const [time, setTime] = useState<string | null>(null)
  const [pending, setPending] = useState<Appointment | null>(null)
  const { busy, run } = useAction()
  const times = [...new Set(slots.filter((s) => sameDay(new Date(s.startTime), day)).map((s) => s.startTime))].sort()
  const freeAt = (t: string) => slots.filter((s) => s.startTime === t).length
  const book = async () => {
    for (const s of slots.filter((x) => x.startTime === time)) {
      try {
        return await api.book(s)
      } catch (e: any) {
        if (e.status !== 409) throw e
      }
    }
    reload()
    setTime(null)
    throw new Error('That time was just taken. Please pick another.')
  }
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft/60 text-brand">
            <Stethoscope className="size-5" />
          </div>
          <div>
            <h3 className="font-bold">General consultation · {FEES.GENERAL.toLocaleString()} XAF</h3>
            <p className="mt-0.5 text-xs text-muted">
              Choose a day and time. We'll assign whichever general practitioner is free then, so you don't pick a
              doctor here.
            </p>
          </div>
        </div>
      </Card>
      <DayStrip
        days={days}
        day={day}
        setDay={(d) => {
          setDay(d)
          setTime(null)
        }}
        has={(d) => slots.some((s) => sameDay(new Date(s.startTime), d))}
        off={isPastDay}
        count={(d) => new Set(slots.filter((s) => sameDay(new Date(s.startTime), d)).map((s) => s.startTime)).size}
      />
      <Card className="p-5">
        <SectionHead
          title="Choose a time"
          aside={<span className="text-xs text-muted">{fmtFull(day.toISOString())}</span>}
        />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {times.map((t) => (
            <button
              key={t}
              onClick={() => setTime(t)}
              className={cx(
                'h-12 rounded-full text-sm font-semibold transition',
                time === t ? 'bg-brand text-white' : 'bg-brand-soft/50 text-brand-deep hover:bg-brand-soft',
              )}
            >
              {fmtTime(t)}
              <span className="ml-1 text-[10px] opacity-70">· {freeAt(t)}</span>
            </button>
          ))}
        </div>
        {!times.length && (
          <div className="py-4 text-center text-sm text-muted">
            No general slots this day.{' '}
            <button onClick={onWaitlist} className="font-semibold text-brand">
              Join the waitlist →
            </button>
          </div>
        )}
      </Card>
      <Button
        className="w-full !h-14 text-base"
        disabled={!time || busy}
        onClick={async () => {
          const a = await run(book)
          if (a) {
            toast(`Assigned to ${displayName(dir.user(a.doctorId))}`, true)
            setPending(a)
          }
        }}
      >
        Book general consultation
      </Button>
      {pending && (
        <PaymentSheet
          a={pending}
          dir={dir}
          onClose={() => {
            setPending(null)
            setTime(null)
            reload()
          }}
          onPaid={() => {
            setPending(null)
            onBooked()
          }}
        />
      )}
    </div>
  )
}
