import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="animate-rise rounded-3xl border border-dashed border-ink/10 p-8 text-center text-sm text-muted">
    <div className="relative mx-auto mb-3 grid size-12 place-items-center">
      <span className="absolute inset-0 rounded-full bg-brand-soft/50 animate-ping-soft" />
      <span className="relative grid size-12 place-items-center rounded-full bg-brand-soft/60 text-brand animate-float">
        <Sparkles className="size-5" />
      </span>
    </div>
    {children}
  </div>
)
