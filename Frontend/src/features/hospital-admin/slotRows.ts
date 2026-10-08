import { BUFFER_SAME, MAX_SLOT_H, type Slot } from '@/api'

// The rows of the "Propose availability" form: one slot per row, with the exact date and times the admin chose.
export interface SlotRow {
  date: string
  start: string
  end: string
}

export const emptyRow = (): SlotRow => ({ date: '', start: '', end: '' })

const isComplete = (r: SlotRow) => !!r.date && !!r.start && !!r.end
const startMs = (r: SlotRow) => +new Date(`${r.date}T${r.start}`)
const endMs = (r: SlotRow) => +new Date(`${r.date}T${r.end}`)

const clashes = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd + BUFFER_SAME * 6e4 && aEnd > bStart - BUFFER_SAME * 6e4

/**
 * What is wrong with each row (null = fine or still being filled in), mirroring the backend's checks:
 * end after start, at most MAX_SLOT_H hours, in the future, and no overlap or gap under BUFFER_SAME minutes with an
 * earlier row or with the doctor's existing slots at this hospital. \`ready\` is true when every row is complete and valid.
 */
export function checkRows(rows: SlotRow[], existing: Slot[]): { errors: (string | null)[]; ready: boolean } {
  const live = existing.filter((s) => ['PENDING', 'APPROVED', 'BOOKED', 'OFFERED'].includes(s.status))
  const errors = rows.map((row, i): string | null => {
    if (!isComplete(row)) return null
    const s = startMs(row)
    const e = endMs(row)
    if (Number.isNaN(s) || Number.isNaN(e)) return 'Enter a valid date and times'
    if (e <= s) return 'The end time must be after the start time'
    if (e - s > MAX_SLOT_H * 36e5) return `A slot can last at most ${MAX_SLOT_H} hours`
    if (s <= Date.now()) return 'The slot must start in the future'
    for (let j = 0; j < i; j++) {
      const other = rows[j]
      if (isComplete(other) && clashes(s, e, startMs(other), endMs(other)))
        return `Overlaps slot ${j + 1}, or is less than ${BUFFER_SAME} min from it`
    }
    if (live.some((x) => clashes(s, e, +new Date(x.startTime), +new Date(x.endTime))))
      return `Clashes with a slot this doctor already has (keep ${BUFFER_SAME} min between slots)`
    return null
  })
  return { errors, ready: rows.length > 0 && rows.every(isComplete) && errors.every((e) => e === null) }
}

export const toProposal = (row: SlotRow) => ({
  startTime: new Date(`${row.date}T${row.start}`).toISOString(),
  endTime: new Date(`${row.date}T${row.end}`).toISOString(),
})
