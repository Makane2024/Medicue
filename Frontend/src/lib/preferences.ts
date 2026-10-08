import { useEffect, useState } from 'react'

export type Prefs = {
  theme: 'light' | 'dark' | 'system'
  accent: 'blue' | 'teal' | 'violet' | 'rose'
  text: 'normal' | 'large'
  motion: 'full' | 'reduce'
  emailAlerts: boolean
  smsAlerts: boolean
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  accent: 'blue',
  text: 'normal',
  motion: 'full',
  emailAlerts: true,
  smsAlerts: true,
}

let prefs: Prefs = (() => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('medicue.prefs') ?? '{}') }
  } catch {
    return DEFAULT_PREFS
  }
})()

let prefSubs: (() => void)[] = []

export const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

function applyPrefs() {
  const r = document.documentElement
  r.classList.toggle('dark', prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches))
  r.dataset.accent = prefs.accent
  r.dataset.text = prefs.text
  if (prefs.motion === 'reduce') r.dataset.motion = 'reduce'
  else delete r.dataset.motion
}
applyPrefs()
darkQuery.addEventListener('change', applyPrefs)

export const setPrefs = (p: Partial<Prefs>) => {
  prefs = { ...prefs, ...p }
  localStorage.setItem('medicue.prefs', JSON.stringify(prefs))
  applyPrefs()
  prefSubs.forEach((f) => f())
}

export function usePrefs() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    prefSubs.push(f)
    return () => {
      prefSubs = prefSubs.filter((x) => x !== f)
    }
  }, [])
  return prefs
}

export const isDark = () => document.documentElement.classList.contains('dark')
