// Mirrors Backend/lambda/lib/stats.ts: appointment counts per status, in total and per calendar day.

import type { AppointmentStats } from '../types'

const STATUSES = [
  'COMPLETED',
  'ARRIVED',
  'CONFIRMED',
  'MISSED',
  'CANCELLED',
  'RESCHEDULED',
  'PENDING_PAYMENT',
  'EXPIRED',
]

// the viewer's calendar day of an instant; tz is Date#getTimezoneOffset (UTC minus local)
const localDate = (iso: string, tz: number) => new Date(new Date(iso).getTime() - tz * 6e4).toISOString().slice(0, 10)

export function summarize(
  appts: { startTime: string; status: string }[],
  from: string,
  to: string,
  tz: number,
): AppointmentStats {
  const days: AppointmentStats['days'] = []
  const byDate = new Map<string, AppointmentStats['days'][number]>()
  for (
    let t = Date.parse(`${localDate(from, tz)}T00:00:00Z`);
    t <= Date.parse(`${localDate(to, tz)}T00:00:00Z`);
    t += 864e5
  ) {
    const day = { date: new Date(t).toISOString().slice(0, 10), counts: {} as Record<string, number> }
    days.push(day)
    byDate.set(day.date, day)
  }
  const totals: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const a of appts) {
    if (a.startTime < from || a.startTime > to) continue
    totals[a.status] = (totals[a.status] ?? 0) + 1
    total++
    const day = byDate.get(localDate(a.startTime, tz))
    if (day) day.counts[a.status] = (day.counts[a.status] ?? 0) + 1
  }
  return { from, to, total, totals, days }
}
