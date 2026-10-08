import type { ReactNode } from 'react'
import { cx } from '@/lib/classNames'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string, ReactNode?][]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-full bg-mist p-1">
      {options.map(([v, l, icon]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cx(
            'flex h-10 flex-1 items-center justify-center gap-2 rounded-full px-4 text-xs font-bold transition',
            value === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {icon}
          {l}
        </button>
      ))}
    </div>
  )
}
