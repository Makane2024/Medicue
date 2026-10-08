import { ArrowUpRight } from 'lucide-react'
import { cx } from '@/lib/classNames'

export function Button({
  children,
  variant = 'primary',
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'white' | 'danger' }) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-deep shadow-[0_10px_24px_-12px_rgba(59,107,224,0.9)]',
    soft: 'bg-brand-soft/70 text-brand-deep hover:bg-brand-soft',
    ghost: 'text-muted hover:text-ink hover:bg-mist',
    white: 'bg-surface text-ink hover:bg-mist',
    danger:
      'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-400/15 dark:text-rose-300 dark:hover:bg-rose-400/25',
  }[variant]
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 text-sm font-semibold transition disabled:opacity-50 disabled:pointer-events-none',
        v,
        className,
      )}
    >
      {children}
    </button>
  )
}

export const ArrowButton = ({ onClick, dark }: { onClick?: () => void; dark?: boolean }) => (
  <button
    onClick={onClick}
    aria-label="Open"
    className={cx(
      'grid place-items-center size-11 shrink-0 rounded-full border transition hover:-rotate-12',
      dark
        ? 'bg-surface text-brand border-white'
        : 'border-ink/10 text-ink hover:bg-brand hover:text-white hover:border-brand',
    )}
  >
    <ArrowUpRight className="size-[18px]" />
  </button>
)
