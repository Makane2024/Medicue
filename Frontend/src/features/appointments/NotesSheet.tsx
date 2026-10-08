import { useState } from 'react'
import { Lock } from 'lucide-react'
import { api, type Appointment } from '@/api'
import { Button, Empty, Modal } from '@/components/ui'
import { displayName, fmtFull, fmtTime } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import type { Dir } from '@/state/directory'

export function NotesSheet({
  a,
  dir,
  canWrite,
  onClose,
}: {
  a: Appointment
  dir: Dir
  canWrite: boolean
  onClose: () => void
}) {
  // a doctor reads the notes they wrote for this patient, a patient reads their own; both narrowed to this session
  const [notes, reload] = useLoad(async () =>
    (await api.notes(canWrite ? a.patientId : undefined)).filter((n) => n.appointmentId === a.appointmentId),
  )
  const [text, setText] = useState('')
  const { busy, run } = useAction()
  return (
    <Modal wide onClose={onClose} title={`Session notes · ${fmtFull(a.startTime)}`}>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Lock className="size-3.5" />
        Private to {displayName(dir.user(a.patientId))} and {displayName(dir.user(a.doctorId))}
      </p>
      <div className="mt-4 space-y-2">
        {notes?.map((n) => (
          <div key={n.noteId} className="rounded-2xl bg-mist p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.content}</p>
            <p className="mt-2 text-[11px] text-muted">
              {displayName(dir.user(n.doctorId))} · {fmtFull(n.createdAt)} {fmtTime(n.createdAt)}
            </p>
          </div>
        ))}
        {notes && !notes.length && <Empty>No notes for this session yet.</Empty>}
      </div>
      {canWrite && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={10000}
            rows={6}
            placeholder="Symptoms, findings, diagnosis, prescription, follow-up…"
            className="mt-4 w-full rounded-2xl bg-surface p-4 text-sm outline-none ring-1 ring-ink/10 focus:ring-2 focus:ring-brand/40"
          />
          <Button
            className="mt-3 w-full"
            disabled={!text.trim() || busy}
            onClick={async () => {
              if (await run(() => api.recordNote(a.appointmentId, text.trim()), 'Note saved')) {
                setText('')
                reload()
              }
            }}
          >
            Save note
          </Button>
        </>
      )}
    </Modal>
  )
}
