import { Check, X } from 'lucide-react'
import { api, BUFFER_CROSS, BUFFER_SAME, prettySpecialty, type Slot } from '@/api'
import { Badge, Button, Card, Empty, SectionHead } from '@/components/ui'
import { fmtDay, fmtTime } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import type { Dir } from '@/state/directory'

export function DoctorSchedule({ dir }: { dir: Dir }) {
  const [pending, reloadPending] = useLoad(() => api.pendingSlots())
  const [mine, reloadMine] = useLoad(() => api.mySlots())
  const { busy, run } = useAction()
  const upcoming = (mine ?? [])
    .filter((s) => ['APPROVED', 'BOOKED', 'OFFERED'].includes(s.status))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const decide = async (s: Slot, decision: 'APPROVED' | 'REJECTED') => {
    if (
      await run(
        () => api.approveSlot(s, decision),
        decision === 'APPROVED' ? 'Slot approved · now bookable' : 'Slot rejected',
      )
    ) {
      reloadPending()
      reloadMine()
    }
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <section>
        <SectionHead title={`Awaiting your approval (${pending?.length ?? 0})`} />
        <p className="-mt-1 mb-4 text-xs text-muted">
          Hospitals propose your availability. Conflicts are checked again at approval: {BUFFER_SAME}-minute buffer at
          the same hospital, {BUFFER_CROSS} minutes between hospitals.
        </p>
        <div className="space-y-3">
          {pending?.map((s) => (
            <Card key={s.slotId} className="flex flex-wrap items-center gap-4 p-4 !rounded-[24px]">
              <div className="grid w-16 place-items-center rounded-2xl bg-brand py-2 text-white">
                <span className="text-[11px] font-semibold">
                  {new Date(s.startTime).toLocaleDateString([], { weekday: 'short' })}
                </span>
                <span className="text-xl font-bold">{new Date(s.startTime).getDate()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                </div>
                <div className="text-xs text-muted">
                  {dir.hospital(s.hospitalId)?.name} · {prettySpecialty(s.specialtyId)} ·{' '}
                  {s.consultationType === 'GENERAL' ? 'General' : 'Specialist'}
                </div>
              </div>
              <Button variant="danger" className="!h-10" disabled={busy} onClick={() => decide(s, 'REJECTED')}>
                <X className="size-4" />
                Reject
              </Button>
              <Button className="!h-10" disabled={busy} onClick={() => decide(s, 'APPROVED')}>
                <Check className="size-4" />
                Approve
              </Button>
            </Card>
          ))}
          {pending && !pending.length && <Empty>No proposals waiting.</Empty>}
        </div>
      </section>
      <section>
        <SectionHead title="Approved schedule" />
        <Card className="divide-y divide-ink/5 p-2">
          {upcoming.slice(0, 10).map((s) => (
            <div key={s.slotId} className="flex items-center gap-3 p-3">
              <div className="w-14 text-xs font-bold">{fmtDay(s.startTime)}</div>
              <div className="flex-1 text-sm">
                {fmtTime(s.startTime)}
                <span className="block text-[11px] text-muted">{dir.hospital(s.hospitalId)?.name}</span>
              </div>
              <Badge s={s.status} />
            </div>
          ))}
          {!upcoming.length && <p className="p-4 text-sm text-muted">Nothing scheduled.</p>}
        </Card>
      </section>
    </div>
  )
}
