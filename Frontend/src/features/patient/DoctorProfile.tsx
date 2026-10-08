import { useMemo, useState } from 'react'
import { ChevronLeft, Lock, Star } from 'lucide-react'
import { api, type Appointment, FEES, MAX_VISIT_NOTE, type Slot } from '@/api'
import { ReportButton } from '@/components/ReportButton'
import { Avatar, Button, Card, Empty, SectionHead, Stars } from '@/components/ui'
import { PaymentSheet } from '@/features/appointments/PaymentSheet'
import { cx } from '@/lib/classNames'
import { displayName, fmtFull, fmtTime, sameDay } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { type Dir, loadAppointments } from '@/state/directory'
import { DayStrip, isPastDay, isWeekend, nextDays } from './DayStrip'
import { ReviewSheet } from './ReviewSheet'

export function DoctorProfile({
  dir,
  doctorId,
  slots,
  back,
  onBooked,
}: {
  dir: Dir
  doctorId: string
  slots: Slot[]
  back: () => void
  onBooked: () => void
}) {
  const d = dir.user(doctorId)
  const days = useMemo(nextDays, [])
  // specialist consultations are not offered at weekends, and a day that is over cannot be booked
  const closed = (x: Date) => isWeekend(x) || isPastDay(x)
  const [day, setDay] = useState(
    () =>
      days.find((x) => !closed(x) && slots.some((s) => sameDay(new Date(s.startTime), x))) ??
      days.find((x) => !closed(x)) ??
      days[0],
  )
  const [slot, setSlot] = useState<Slot | null>(null)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<Appointment | null>(null)
  const [reviews, reloadReviews] = useLoad(() => api.doctorReviews(doctorId))
  const [appts] = useLoad(loadAppointments)
  const [reviewing, setReviewing] = useState<Appointment | null>(null)
  const { busy, run } = useAction()
  const daySlots = slots
    .filter((s) => sameDay(new Date(s.startTime), day))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const avg = reviews?.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0
  const reviewable = (appts ?? []).find(
    (a) =>
      a.doctorId === doctorId && a.status === 'COMPLETED' && !reviews?.some((r) => r.appointmentId === a.appointmentId),
  )
  const stats = [
    [avg ? avg.toFixed(1) : '—', 'Rating'],
    [String(reviews?.length ?? 0), 'Reviews'],
    [String(slots.length), 'Open slots'],
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Card className="relative overflow-hidden bg-gradient-to-b from-surface to-brand-soft/40 p-6 min-h-[460px]">
          <button onClick={back} className="relative z-10 grid size-10 place-items-center rounded-full bg-surface">
            <ChevronLeft className="size-5" />
          </button>
          {d?.photo && (
            <img
              src={d.photo}
              alt=""
              className="absolute right-0 bottom-28 h-[72%] w-[55%] object-cover object-top [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
            />
          )}
          <div className={cx('relative mt-6', d?.photo && 'max-w-[50%]')}>
            <h2 className="text-[32px] leading-[1.05] font-semibold tracking-tight">{displayName(d)}</h2>
            <p className="mt-2 text-sm text-muted">{d?.specialty}</p>
            <p className="mt-4 text-sm">
              <b className="text-lg">{FEES.SPECIALIST.toLocaleString()} XAF</b>{' '}
              <span className="text-muted">/ session</span>
            </p>
            {d?.bio && <p className="mt-4 text-[13px] leading-relaxed text-ink/75">{d.bio}</p>}
          </div>
          <div className="absolute inset-x-5 bottom-5 grid grid-cols-3 rounded-[22px] bg-surface/60 p-4 text-center backdrop-blur-xl">
            {stats.map(([v, l]) => (
              <div key={l}>
                <div className="text-xl font-semibold">{v}</div>
                <div className="text-[11px] text-muted">{l}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <DayStrip
            days={days}
            day={day}
            setDay={(x) => {
              setDay(x)
              setSlot(null)
            }}
            has={(x) => slots.some((s) => sameDay(new Date(s.startTime), x))}
            off={closed}
            count={(x) => slots.filter((s) => sameDay(new Date(s.startTime), x)).length}
          />
          <Card className="p-5">
            <SectionHead
              title="Choose a time"
              aside={<span className="text-xs text-muted">{fmtFull(day.toISOString())}</span>}
            />
            <div className="grid grid-cols-3 gap-2">
              {daySlots.map((s) => (
                <button
                  key={s.slotId}
                  onClick={() => setSlot(s)}
                  className={cx(
                    'h-11 rounded-full text-sm font-semibold transition',
                    slot?.slotId === s.slotId
                      ? 'bg-brand text-white'
                      : 'bg-brand-soft/50 text-brand-deep hover:bg-brand-soft',
                  )}
                >
                  {fmtTime(s.startTime)}
                </button>
              ))}
            </div>
            {!daySlots.length && (
              <p className="py-4 text-center text-sm text-muted">
                No approved slots this day. You can join this doctor's waitlist from the Waitlist tab.
              </p>
            )}
          </Card>
          {slot && (
            <Card className="p-5">
              <label htmlFor="visit-note" className="text-sm font-bold">
                What are you coming in for? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="visit-note"
                rows={3}
                maxLength={MAX_VISIT_NOTE}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For example: a check-up on my blood pressure, or pain in my lower back for two weeks"
                className="mt-2 w-full rounded-2xl bg-mist p-4 text-sm outline-none ring-brand/40 placeholder:text-muted/70 focus:ring-2"
              />
              <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                  <Lock className="size-3 shrink-0" />
                  Only you and {displayName(d)} can read this.
                </span>
                <span className="tabular-nums">
                  {note.length}/{MAX_VISIT_NOTE}
                </span>
              </div>
            </Card>
          )}
          <Button
            className="w-full !h-14 text-base"
            disabled={!slot || busy}
            onClick={async () => {
              const a = await run(() => api.book(slot!, note))
              if (a) setPending(a)
            }}
          >
            Book appointment
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-bold">Patient reviews</h3>
          {avg > 0 && (
            <span className="flex items-center gap-2 text-sm">
              <Stars n={avg} /> <b>{avg.toFixed(1)}</b>
              <span className="text-muted">({reviews!.length})</span>
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {reviewable && (
              <Button className="!h-10" onClick={() => setReviewing(reviewable)}>
                <Star className="size-4" />
                Write a review
              </Button>
            )}
            <ReportButton userId={doctorId} />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {reviews?.map((r) => (
            <div key={r.reviewId} className="rounded-2xl bg-mist p-4">
              <div className="flex items-center gap-2">
                <Avatar u={dir.user(r.patientId)} size="size-8" />
                <span className="text-sm font-semibold">
                  {r.patientName ?? dir.user(r.patientId)?.firstName ?? 'Patient'}
                </span>
                <span className="ml-auto">
                  <Stars n={r.rating} />
                </span>
              </div>
              <p className="mt-2 text-sm text-ink/80">{r.comment}</p>
              <p className="mt-1 text-[11px] text-muted">{fmtFull(r.createdAt)}</p>
            </div>
          ))}
        </div>
        {reviews && !reviews.length && <Empty>No reviews yet.</Empty>}
        {!reviewable && (
          <p className="mt-3 text-[11px] text-muted">
            Only patients who've completed a session with this doctor can leave a review.
          </p>
        )}
      </Card>
      {pending && (
        <PaymentSheet
          a={pending}
          dir={dir}
          onClose={() => {
            setPending(null)
            back()
          }}
          onPaid={() => {
            setPending(null)
            onBooked()
          }}
        />
      )}
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
