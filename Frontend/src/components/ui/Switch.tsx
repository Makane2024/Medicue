import { cx } from '@/lib/classNames'

export function Switch({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 py-3">
      <div className="flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition', on ? 'bg-brand' : 'bg-ink/15')}
      >
        <span
          className={cx('absolute top-1 size-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')}
        />
      </button>
    </label>
  )
}
