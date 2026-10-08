import type { User } from '@/api'

export const fmtTime = (s: string) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const fmtDay = (s: string) => new Date(s).toLocaleDateString([], { day: 'numeric', month: 'short' })

export const fmtFull = (s: string) =>
  new Date(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

export const displayName = (u?: User) =>
  u ? (u.role === 'DOCTOR' ? `Dr. ${u.firstName} ${u.lastName}` : `${u.firstName} ${u.lastName}`) : '—'

/** The short reference a patient shows at reception, e.g. APT-935F448E. */
export const apptRef = (appointmentId: string) =>
  'APT-' +
  appointmentId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-8)
    .toUpperCase()
