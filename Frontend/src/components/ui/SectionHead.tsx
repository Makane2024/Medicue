import type { ReactNode } from 'react'

export const SectionHead = ({ title, aside }: { title: string; aside?: ReactNode }) => (
  <div className="mb-3 flex items-end justify-between">
    <h2 className="text-[15px] font-bold">{title}</h2>
    {aside}
  </div>
)
