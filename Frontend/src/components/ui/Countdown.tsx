import { useEffect, useState } from 'react'

export function Countdown({ until, onDone }: { until: number; onDone?: () => void }) {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, until - n)
  useEffect(() => {
    if (left === 0) onDone?.()
  }, [left === 0])
  const m = Math.floor(left / 6e4),
    s = Math.floor(left / 1000) % 60
  return (
    <span className="font-mono tabular-nums">
      {m}:{String(s).padStart(2, '0')}
    </span>
  )
}
