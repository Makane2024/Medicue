import type { ReactNode } from 'react'
import { CalendarDays, Clock, MessageSquareText } from 'lucide-react'
import { type Appointment, FEES, prettySpecialty } from '@/api'
import { Avatar, Badge, Card } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { apptRef, displayName, fmtFull, fmtTime } from '@/lib/format'
import type { Dir } from '@/state/directory'

export function ApptRow({
  a,
  dir,
  actions,
  who = 'doctor',
  showFee = true,
}: {
  a: Appointment
  dir: Dir
  actions?: ReactNode
  who?: 'doctor' | 'patient'
  showFee?: boolean
}) {
  const u = dir.user(who === 'doctor' ? a.doctorId : a.patientId)
  const live = a.status === 'CONFIRMED' && +new Date(a.startTime) <= Date.now() && +new Date(a.endTime) > Date.now()
  return (
    <Card
      className={cx(
        'p-4 !rounded-[24px]',
        live && 'ring-2 ring-brand/40',
        a.status === 'ARRIVED' && 'ring-2 ring-teal-400/50',
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar u={u} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{displayName(u)}</div>
          <div className="truncate text-xs text-muted">
            {prettySpecialty(a.specialtyId) ||
              (a.consultationType === 'GENERAL' ? 'General consultation' : 'Specialist')}{' '}
            · {a.hospitalName ?? dir.hospital(a.hospitalId)?.name}
          </div>
        </div>
        {live ? (
          <span className="flex h-6 items-center gap-1.5 rounded-full bg-brand px-2.5 text-[11px] font-bold text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-surface" />
            IN SESSION
          </span>
        ) : (
          <Badge s={a.status} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-mist px-4 py-2.5 text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5 text-brand" />
          {fmtFull(a.startTime)}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-brand" />
          {fmtTime(a.startTime)} – {fmtTime(a.endTime)}
        </span>
        <span className="font-mono text-[10px] font-semibold text-muted">{apptRef(a.appointmentId)}</span>
        {showFee && (
          <span className="ml-auto text-muted">{(a.fee ?? FEES[a.consultationType]).toLocaleString()} XAF</span>
        )}
      </div>
      {a.note && (
        <div className="mt-3 flex gap-2.5 rounded-2xl bg-brand-soft/30 px-4 py-3 text-xs">
          <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-brand" />
          <div className="min-w-0">
            <div className="font-bold text-brand-deep">Reason for the visit</div>
            <p className="mt-0.5 whitespace-pre-line break-words text-ink/80">{a.note}</p>
          </div>
        </div>
      )}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </Card>
  )
}
