import { cx } from '@/lib/classNames'
import { sameDay } from '@/lib/format'

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

/** A day that is over (today is not). */
export const isPastDay = (d: Date) => {
  const today = new Date()
  return (
    new Date(d.getFullYear(), d.getMonth(), d.getDate()) <
    new Date(today.getFullYear(), today.getMonth(), today.getDate())
  )
}

/**
 * The week to pick a day from. A day in `off` (a weekend for specialists, a day that is over) is greyed out and
 * cannot be picked; a day that is open but has nothing free is only dimmed, so the waitlist stays reachable.
 */
export function DayStrip({
  days,
  day,
  setDay,
  has,
  off,
  count,
}: {
  days: Date[]
  day: Date
  setDay: (d: Date) => void
  has: (d: Date) => boolean
  off?: (d: Date) => boolean
  count?: (d: Date) => number
}) {
  return (
    <div className="grid grid-cols-7 gap-1 rounded-[24px] bg-surface/60 p-2">
      {days.map((x) => {
        const closed = off?.(x) ?? false
        const on = !closed && sameDay(x, day)
        const free = count?.(x)
        return (
          <button
            key={x.toISOString()}
            disabled={closed}
            aria-disabled={closed}
            title={closed ? 'Not available for booking' : undefined}
            onClick={() => setDay(x)}
            className={cx(
              'flex flex-col items-center gap-1 rounded-full py-3 text-sm transition',
              closed
                ? 'cursor-not-allowed text-muted opacity-35'
                : on
                  ? 'bg-brand text-white'
                  : has(x)
                    ? 'hover:bg-surface'
                    : 'text-muted hover:bg-surface',
            )}
          >
            <span className="text-xs font-semibold">{x.toLocaleDateString([], { weekday: 'short' })}</span>
            <span
              className={cx(
                'grid size-9 place-items-center rounded-full text-base font-semibold',
                on && 'bg-surface text-brand',
                closed && 'bg-mist',
              )}
            >
              {x.getDate()}
            </span>
            {free !== undefined && (
              <span className="text-[10px] font-semibold opacity-80">
                {closed ? '' : free ? `${free} free` : 'None'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const nextDays = () =>
  Array.from({ length: 7 }, (_, i) => {
    const x = new Date()
    x.setDate(x.getDate() + i)
    return x
  })
