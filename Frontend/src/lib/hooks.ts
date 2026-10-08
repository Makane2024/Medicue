import { useCallback, useEffect, useState } from 'react'
import { toast } from './toast'

export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true)
    try {
      const r = await fn()
      if (ok) toast(ok, true)
      return r
    } catch (e: any) {
      toast(e.message ?? 'Something went wrong', false)
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, run }
}

export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    fn()
      .then((d) => live && setData(d))
      .catch((e) => toast(e.message, false))
    return () => {
      live = false
    }
  }, [tick, ...deps])
  return [data, () => setTick((t) => t + 1)] as const
}
