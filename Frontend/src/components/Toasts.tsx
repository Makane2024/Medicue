import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { cx } from '@/lib/classNames'
import { registerToast } from '@/lib/toast'

interface ToastItem {
  id: number
  message: string
  ok: boolean
}

const LIFETIME_MS = 3600

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    registerToast((message, ok = true) => {
      const id = Date.now() + Math.random()
      setItems((current) => [...current, { id, message, ok }])
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), LIFETIME_MS)
    })
  }, [])

  return (
    <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={cx(
            'flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-xl',
            item.ok ? 'bg-surface text-ink' : 'bg-rose-600 text-white',
          )}
        >
          {item.ok ? <Check className="size-4 text-emerald-500" /> : <X className="size-4" />}
          {item.message}
        </div>
      ))}
    </div>
  )
}
