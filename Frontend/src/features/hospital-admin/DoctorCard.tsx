import { CalendarClock, CalendarPlus, Trash2 } from 'lucide-react'
import type { DoctorInfo, Review } from '@/api'
import { Avatar, Button, Card, Stars } from '@/components/ui'
import { displayName, fmtFull, fmtTime } from '@/lib/format'
import { asUser } from '@/state/directory'

export interface DoctorFigures {
  open: number
  booked: number
  pending: number
  next?: string
}

/** One doctor of the hospital: who they are, how busy their calendar is, and the actions the admin needs. */
export function DoctorCard({
  doctor,
  figures,
  reviews,
  busy,
  onRemove,
  onPropose,
}: {
  doctor: DoctorInfo
  figures: DoctorFigures
  reviews: Review[]
  busy: boolean
  onRemove: () => void
  onPropose: () => void
}) {
  const u = asUser(doctor)
  const rating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0
  return (
    <Card className="flex flex-col p-5 !rounded-[26px]">
      <div className="flex items-start gap-3.5">
        <Avatar u={{ ...u, photo: doctor.photo }} size="size-16" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{displayName(u)}</div>
          <span className="mt-1 inline-flex rounded-full bg-brand-soft/60 px-2.5 py-0.5 text-[11px] font-bold text-brand-deep">
            {doctor.specialty}
          </span>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            {reviews.length ? (
              <>
                <Stars n={rating} />
                <b className="text-ink">{rating.toFixed(1)}</b>({reviews.length})
              </>
            ) : (
              'No reviews yet'
            )}
          </div>
        </div>
        <button
          aria-label={`Remove ${displayName(u)}`}
          disabled={busy}
          onClick={onRemove}
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-400/15"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-ink/75">
        {doctor.bio || <span className="text-muted">No description yet. Doctors can add one from their profile.</span>}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ['Open slots', figures.open, 'text-emerald-600 dark:text-emerald-300'],
            ['Booked', figures.booked, 'text-brand-deep'],
            ['Awaiting approval', figures.pending, 'text-amber-600 dark:text-amber-300'],
          ] as const
        ).map(([label, n, tone]) => (
          <div key={label} className="rounded-2xl bg-mist px-1 py-2.5">
            <div className={`text-xl font-extrabold tabular-nums ${tone}`}>{n}</div>
            <div className="text-[10px] font-semibold leading-tight text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted">
          <CalendarClock className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">
            {figures.next ? `Next: ${fmtFull(figures.next)} · ${fmtTime(figures.next)}` : 'Nothing scheduled yet'}
          </span>
        </div>
        <Button variant="soft" className="!h-9 !px-4 text-xs" onClick={onPropose}>
          <CalendarPlus className="size-3.5" />
          Propose slots
        </Button>
      </div>
    </Card>
  )
}
