import { useState } from 'react'
import { Star } from 'lucide-react'
import { api, type Appointment } from '@/api'
import { Button, Modal } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { displayName, fmtFull } from '@/lib/format'
import { useAction } from '@/lib/hooks'
import type { Dir } from '@/state/directory'

export function ReviewSheet({
  a,
  dir,
  onClose,
  onDone,
}: {
  a: Appointment
  dir: Dir
  onClose: () => void
  onDone: () => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const { busy, run } = useAction()
  return (
    <Modal onClose={onClose} title={`Review ${displayName(dir.user(a.doctorId))}`}>
      <p className="text-xs text-muted">Your session on {fmtFull(a.startTime)}</p>
      <div className="my-5 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => setRating(i)} aria-label={`${i} stars`}>
            <Star
              className={cx(
                'size-9 transition',
                i <= rating ? 'fill-amber-400 text-amber-400' : 'text-ink/15 hover:text-amber-300',
              )}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        placeholder="How was your visit?"
        className="w-full rounded-2xl bg-mist p-4 text-sm outline-none ring-brand/40 focus:ring-2"
      />
      <Button
        className="mt-4 w-full"
        disabled={!rating || busy}
        onClick={async () => {
          if (await run(() => api.createReview(a.appointmentId, rating, comment), 'Thanks for your review')) onDone()
        }}
      >
        Submit review
      </Button>
    </Modal>
  )
}
