import type { Note } from '@/api'
import { Avatar, Card, Empty } from '@/components/ui'
import { displayName, fmtFull } from '@/lib/format'
import type { Dir } from '@/state/directory'

export function NotesList({ notes, dir, empty }: { notes: Note[] | null; dir: Dir; empty: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {notes?.map((n) => (
        <Card key={n.noteId} className="p-5">
          <div className="flex items-center gap-3">
            <Avatar u={dir.user(n.doctorId)} size="size-10" />
            <div className="flex-1">
              <div className="text-sm font-bold">{displayName(dir.user(n.doctorId))}</div>
              <div className="text-xs text-muted">
                {dir.hospital(n.hospitalId)?.name} · {fmtFull(n.createdAt)}
              </div>
            </div>
          </div>
          <p className="mt-4 rounded-2xl bg-mist p-4 text-sm leading-relaxed">{n.content}</p>
        </Card>
      ))}
      {notes && !notes.length && (
        <div className="md:col-span-2">
          <Empty>{empty}</Empty>
        </div>
      )}
    </div>
  )
}
