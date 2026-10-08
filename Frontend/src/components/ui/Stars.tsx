import { Star } from 'lucide-react'
import { cx } from '@/lib/classNames'

export const Stars = ({ n, size = 'size-3.5' }: { n: number; size?: string }) => (
  <span className="inline-flex gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className={cx(size, i <= Math.round(n) ? 'fill-amber-400 text-amber-400' : 'text-ink/15')} />
    ))}
  </span>
)
