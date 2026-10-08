import { useEffect, useState } from 'react'
import { api, type Note } from '@/api'
import { Avatar, Empty } from '@/components/ui'
import { NotesList } from '@/features/appointments/NotesList'
import { cx } from '@/lib/classNames'
import { displayName } from '@/lib/format'
import { useLoad } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import { type Dir, loadAppointments } from '@/state/directory'

export function DoctorNotes({ dir }: { dir: Dir }) {
  const [appts] = useLoad(loadAppointments)
  const patients = [...new Set((appts ?? []).filter((a) => a.status === 'COMPLETED').map((a) => a.patientId))]
  const [pid, setPid] = useState('')
  const [notes, setNotes] = useState<Note[] | null>(null)
  useEffect(() => {
    if (pid) {
      setNotes(null)
      api
        .notes(pid)
        .then(setNotes)
        .catch((e) => toast(e.message, false))
    }
  }, [pid])
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {patients.map((p) => (
          <button
            key={p}
            onClick={() => setPid(p)}
            className={cx(
              'flex h-12 items-center gap-2 rounded-full pl-1.5 pr-5 text-sm font-semibold transition',
              pid === p ? 'bg-brand text-white' : 'bg-surface hover:bg-brand-soft/50',
            )}
          >
            <Avatar u={dir.user(p)} size="size-9" />
            {displayName(dir.user(p))}
          </button>
        ))}
      </div>
      {appts && !patients.length && <Empty>Patients appear here once you have a completed session.</Empty>}
      {pid ? (
        <NotesList notes={notes} dir={dir} empty="You haven't authored notes for this patient." />
      ) : (
        patients.length > 0 && <Empty>Select a patient to see notes you've authored for them.</Empty>
      )}
    </div>
  )
}
