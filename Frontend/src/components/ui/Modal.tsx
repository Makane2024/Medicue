import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '@/lib/classNames'
import { Card } from './Card'

export const Modal = ({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) =>
  // on the page itself, so an animated ancestor cannot shrink the dimmed backdrop to part of the screen
  createPortal(
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 backdrop-blur-sm sm:place-items-center">
      <Card className={cx('max-h-[90vh] w-full overflow-auto p-6', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose}>
            <X className="size-5 text-muted" />
          </button>
        </div>
        {children}
      </Card>
    </div>,
    document.body,
  )
