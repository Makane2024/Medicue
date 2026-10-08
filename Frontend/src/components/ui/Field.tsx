import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

const INPUT =
  'h-12 w-full rounded-2xl bg-mist px-4 text-sm outline-none ring-brand/40 focus:ring-2 placeholder:text-muted/60'

/** Password inputs get a show/hide button; every other type renders as a plain input. */
export function Field({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [shown, setShown] = useState(false)
  const isPassword = p.type === 'password'
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
      <div className="relative">
        <input {...p} type={isPassword && shown ? 'text' : p.type} className={isPassword ? `${INPUT} pr-12` : INPUT} />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted transition hover:text-ink"
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
    </label>
  )
}

export function Select({ label, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
      <select {...p} className="h-12 w-full rounded-2xl bg-mist px-4 text-sm outline-none ring-brand/40 focus:ring-2">
        {children}
      </select>
    </label>
  )
}
