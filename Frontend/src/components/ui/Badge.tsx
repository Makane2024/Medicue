import { cx } from '@/lib/classNames'
import { AMBER, BLUE, GREEN, GREY, RED, TEAL } from './tones'

export const STATUS: Record<string, string> = {
  PENDING: AMBER,
  PENDING_PAYMENT: AMBER,
  WAITING: AMBER,
  APPROVED: GREEN,
  COMPLETED: GREEN,
  CONFIRMED: BLUE,
  ARRIVED: TEAL,
  READY: GREY,
  SUSPENDED: AMBER,
  BOOKED: BLUE,
  OFFERED: 'bg-violet-50 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  RESCHEDULED: GREY,
  REJECTED: RED,
  CANCELLED: RED,
  MISSED: RED,
  EXPIRED: GREY,
}

export const Badge = ({ s }: { s: string }) => (
  <span
    className={cx(
      'inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold tracking-wide',
      STATUS[s] ?? 'bg-mist text-muted',
    )}
  >
    {s.replace(/_/g, ' ')}
  </span>
)
