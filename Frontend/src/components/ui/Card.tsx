import type { ReactNode } from 'react'
import { cx } from '@/lib/classNames'

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div
    className={cx(
      'animate-rise rounded-[28px] bg-surface transition-shadow duration-300 hover:shadow-[0_1px_0_rgba(18,21,43,0.04),0_24px_50px_-22px_rgba(42,82,196,0.45)] shadow-[0_1px_0_rgba(18,21,43,0.04),0_18px_40px_-24px_rgba(42,82,196,0.35)]',
      className,
    )}
  >
    {children}
  </div>
)
