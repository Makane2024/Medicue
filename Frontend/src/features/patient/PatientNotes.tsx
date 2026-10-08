import { api } from '@/api'
import { NotesList } from '@/features/appointments/NotesList'
import { useLoad } from '@/lib/hooks'
import type { Dir } from '@/state/directory'

export function PatientNotes({ dir }: { dir: Dir }) {
  const [notes] = useLoad(() => api.notes())
  return <NotesList notes={notes} dir={dir} empty="No medical notes yet. Notes appear after a completed visit." />
}
