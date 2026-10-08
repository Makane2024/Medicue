/** Appointment statuses the statistics report. */
export const STAT_STATUSES = [
  'COMPLETED',
  'ARRIVED',
  'CONFIRMED',
  'MISSED',
  'CANCELLED',
  'RESCHEDULED',
  'PENDING_PAYMENT',
  'EXPIRED',
] as const;

export interface DayStats {
  date: string; // YYYY-MM-DD in the viewer's time zone
  counts: Record<string, number>;
}

/** The viewer's calendar day of an instant. `tzOffsetMinutes` is JavaScript's Date#getTimezoneOffset (UTC minus local). */
export function localDate(iso: string, tzOffsetMinutes: number): string {
  return new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Counts appointments per status, in total and per calendar day, listing every day of the window (even empty ones). */
export function summarize(
  appointments: { startTime: string; status: string }[],
  from: string,
  to: string,
  tzOffsetMinutes: number
) {
  const days: DayStats[] = [];
  const index = new Map<string, DayStats>();
  const first = localDate(from, tzOffsetMinutes);
  const last = localDate(to, tzOffsetMinutes);
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) {
    const day: DayStats = { date: new Date(t).toISOString().slice(0, 10), counts: {} };
    days.push(day);
    index.set(day.date, day);
  }

  const totals: Record<string, number> = Object.fromEntries(STAT_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const appointment of appointments) {
    if (appointment.startTime < from || appointment.startTime > to) continue;
    totals[appointment.status] = (totals[appointment.status] ?? 0) + 1;
    total++;
    const day = index.get(localDate(appointment.startTime, tzOffsetMinutes));
    if (day) day.counts[appointment.status] = (day.counts[appointment.status] ?? 0) + 1;
  }
  return { total, totals, days };
}
