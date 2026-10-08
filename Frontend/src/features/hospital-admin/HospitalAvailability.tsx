import { useState } from 'react'
import { CalendarPlus, Plus, Stethoscope, Trash2, Users } from 'lucide-react'
import {
  api,
  BUFFER_CROSS,
  BUFFER_SAME,
  type ConsultationType,
  FEES,
  MAX_PROPOSAL_SLOTS,
  MAX_SLOT_H,
  type User,
} from '@/api'
import { Avatar, Badge, Button, Card, Field, SectionHead, Segmented, Select } from '@/components/ui'
import { displayName, fmtFull, fmtTime } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import { asUser, type Dir } from '@/state/directory'
import { checkRows, emptyRow, toProposal, type SlotRow } from './slotRows'

// Hospital admins propose availability; the doctor must approve each slot before patients can book it.
// The admin chooses every slot's exact date and times, up to MAX_PROPOSAL_SLOTS per submission, and the slots
// must not clash with each other or with the doctor's existing slots (the backend enforces the same rules).
export function HospitalAvailability({ user, dir }: { user: User; dir: Dir }) {
  const [docs] = useLoad(() => api.doctors(user.hospitalId!))
  const [slots, reload] = useLoad(() => api.hospitalSlots())
  const { busy, run } = useAction()
  const approved = user.hospital?.status === 'APPROVED'
  const [doctorId, setDoctorId] = useState('')
  const [consultationType, setConsultationType] = useState<ConsultationType>('GENERAL')
  const [rows, setRows] = useState<SlotRow[]>([emptyRow()])

  const { errors, ready } = checkRows(
    rows,
    (slots ?? []).filter((s) => s.doctorId === doctorId),
  )
  const setRow = (i: number, patch: Partial<SlotRow>) =>
    setRows((p) => p.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const recent = (slots ?? [])
    .slice()
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, 12)

  const send = async () => {
    await api.proposeSlots({ doctorId, consultationType, slots: rows.map(toProposal) })
    toast(`${rows.length} slot${rows.length === 1 ? '' : 's'} proposed · awaiting doctor approval`, true)
    setRows([emptyRow()])
    reload()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <Card className="h-fit p-6 space-y-3">
        <h3 className="text-lg font-bold">Propose availability</h3>
        <p className="text-xs text-muted">
          Choose the exact date and times of each slot, up to {MAX_PROPOSAL_SLOTS} at once. The doctor is notified and
          must approve before patients can book. Slots need {BUFFER_SAME} min between each other at this hospital, or{' '}
          {BUFFER_CROSS} min from the doctor's slots at another hospital, and each may last at most {MAX_SLOT_H} h.
        </p>
        {!approved && (
          <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
            Available once the platform administrators approve your hospital.
          </p>
        )}
        <Select label="Doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">Select…</option>
          {docs?.map((d) => (
            <option key={d.doctorId} value={d.doctorId}>
              {displayName(asUser(d))} · {d.specialty}
            </option>
          ))}
        </Select>
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-muted">Consultation type (sets the fee)</span>
          <Segmented
            value={consultationType}
            onChange={setConsultationType}
            options={[
              ['GENERAL', `General · ${FEES.GENERAL.toLocaleString()}`, <Users key="g" className="size-4" />],
              [
                'SPECIALIST',
                `Specialist · ${FEES.SPECIALIST.toLocaleString()}`,
                <Stethoscope key="s" className="size-4" />,
              ],
            ]}
          />
        </div>

        <div className="space-y-3 pt-1">
          {rows.map((row, i) => (
            <div key={i} className="space-y-2 rounded-2xl bg-mist/60 p-3">
              <div className="flex items-center">
                <span className="text-xs font-bold">Slot {i + 1}</span>
                {rows.length > 1 && (
                  <button
                    aria-label={`Remove slot ${i + 1}`}
                    onClick={() => setRows((p) => p.filter((_, k) => k !== i))}
                    className="ml-auto grid size-8 place-items-center rounded-full text-muted transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-400/15"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <Field label="Date" type="date" value={row.date} onChange={(e) => setRow(i, { date: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="From"
                  type="time"
                  value={row.start}
                  onChange={(e) => setRow(i, { start: e.target.value })}
                />
                <Field label="To" type="time" value={row.end} onChange={(e) => setRow(i, { end: e.target.value })} />
              </div>
              {errors[i] && <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{errors[i]}</p>}
            </div>
          ))}
        </div>

        <Button
          variant="soft"
          className="w-full"
          disabled={rows.length >= MAX_PROPOSAL_SLOTS}
          onClick={() => setRows((p) => [...p, emptyRow()])}
        >
          <Plus className="size-4" />
          {rows.length >= MAX_PROPOSAL_SLOTS
            ? `Maximum of ${MAX_PROPOSAL_SLOTS} slots reached`
            : `Add another slot (${rows.length} of ${MAX_PROPOSAL_SLOTS})`}
        </Button>
        <Button className="w-full" disabled={busy || !approved || !doctorId || !ready} onClick={() => run(send)}>
          <CalendarPlus className="size-4" />
          Send {rows.length > 1 ? `${rows.length} proposals` : 'proposal'}
        </Button>
      </Card>
      <div>
        <SectionHead title="Slots at your hospital" />
        <Card className="divide-y divide-ink/5 p-2">
          {recent.map((s) => (
            <div key={s.slotId} className="flex items-center gap-3 p-3">
              <Avatar u={dir.user(s.doctorId)} size="size-10" />
              <div className="flex-1 text-sm">
                <b>{displayName(dir.user(s.doctorId))}</b>
                <span className="block text-xs text-muted">
                  {s.consultationType === 'GENERAL' ? 'General' : 'Specialist'} · {fmtFull(s.startTime)} ·{' '}
                  {fmtTime(s.startTime)}–{fmtTime(s.endTime)}
                </span>
              </div>
              <Badge s={s.status} />
            </div>
          ))}
          {slots && !recent.length && <p className="p-4 text-sm text-muted">No slots yet.</p>}
        </Card>
      </div>
    </div>
  )
}
