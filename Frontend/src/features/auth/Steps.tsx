import { Check } from 'lucide-react'
import { cx } from '@/lib/classNames'

const LABELS = ['Your details', 'Verify email']

/** Two-step progress indicator shown during sign-up. */
export function Steps({ at }: { at: 0 | 1 }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold">
      {LABELS.map((label, i) => (
        <div key={label} className={cx('flex items-center gap-2', i <= at ? 'text-brand' : 'text-muted')}>
          {i > 0 && <span className={cx('h-px w-8', i <= at ? 'bg-brand' : 'bg-ink/15')} />}
          <span
            className={cx(
              'grid size-6 place-items-center rounded-full',
              i < at ? 'bg-brand text-white' : i === at ? 'bg-brand-soft text-brand' : 'bg-mist',
            )}
          >
            {i < at ? <Check className="size-3.5" /> : i + 1}
          </span>
          {label}
        </div>
      ))}
    </div>
  )
}
