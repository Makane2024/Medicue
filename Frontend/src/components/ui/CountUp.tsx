import { useEffect, useState } from 'react'

export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (document.documentElement.dataset.motion === 'reduce') {
      setN(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 900, 1)
      setN(Math.round(value * (1 - (1 - p) ** 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{n}</>
}
