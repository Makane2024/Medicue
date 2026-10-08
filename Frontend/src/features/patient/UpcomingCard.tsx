import { CalendarDays, Clock } from 'lucide-react'
import type { Appointment } from '@/api'
import { ArrowButton, Button } from '@/components/ui'
import { displayName, fmtFull, fmtTime } from '@/lib/format'
import type { Dir } from '@/state/directory'

export function UpcomingCard({
  a,
  dir,
  onCancel,
  onDetails,
}: {
  a: Appointment
  dir: Dir
  onCancel: () => void
  onDetails: () => void
}) {
  const d = dir.user(a.doctorId)
  return (
    <div className="relative overflow-hidden rounded-[30px] bg-gradient-to-br from-[#5b86ee] to-brand-deep p-2 text-white shadow-[0_24px_50px_-24px_rgba(42,82,196,0.9)]">
      <div className="pointer-events-none absolute -left-10 -top-10 size-40 rounded-full bg-white/15 blur-2xl animate-drift" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-shimmer" />
      <svg
        viewBox="0 0 400 60"
        className="pointer-events-none absolute inset-x-0 top-[38%] w-full text-white/25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path className="animate-trace" d="M0 34h150l10-20 14 38 12-30 8 12h206" />
      </svg>
      {d?.photo && (
        <img
          src={d.photo}
          alt=""
          className="absolute -right-4 top-0 h-48 w-40 object-cover object-top [mask-image:linear-gradient(to_left,black_55%,transparent)]"
        />
      )}
      <div className="relative p-4 pb-16">
        <div className="flex items-center gap-2 text-xs text-white/80">
          <span className="relative flex size-2">
            <span className="absolute inset-0 rounded-full bg-emerald-300 animate-ping-soft" />
            <span className="relative size-2 rounded-full bg-emerald-300" />
          </span>
          Upcoming appointment
        </div>
        <div className="mt-2 max-w-[60%] text-xl font-bold leading-tight">{displayName(d)}</div>
        <div className="mt-1 text-xs text-white/75">
          {d?.specialty} · {dir.hospital(a.hospitalId)?.name}
        </div>
      </div>
      <div className="relative rounded-[24px] bg-white/15 p-3 backdrop-blur-md">
        <div className="flex items-center gap-3 px-1">
          <div className="flex-1 space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-white/80" />
              {fmtFull(a.startTime)}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-white/80" />
              {fmtTime(a.startTime)} – {fmtTime(a.endTime)}
            </div>
          </div>
          <ArrowButton dark onClick={onDetails} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="white" className="!h-10" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="!h-10 !bg-white/25 !shadow-none hover:!bg-white/35" onClick={onDetails}>
            Details
          </Button>
        </div>
      </div>
    </div>
  )
}
