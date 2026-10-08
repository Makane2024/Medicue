import type { User } from '@/api'
import { cx } from '@/lib/classNames'

export function Avatar({ u, size = 'size-12' }: { u?: User; size?: string }) {
  if (u?.photo)
    return (
      <img src={u.photo} alt="" className={cx(size, 'shrink-0 rounded-full object-cover object-top bg-brand-soft')} />
    )
  return (
    <div
      className={cx(
        size,
        'shrink-0 grid place-items-center rounded-full bg-gradient-to-br from-brand-soft to-surface text-brand-deep text-sm font-bold',
      )}
    >
      {u ? u.firstName[0] + u.lastName[0] : '?'}
    </div>
  )
}
