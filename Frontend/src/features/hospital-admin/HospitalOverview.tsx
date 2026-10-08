import { useState } from 'react'
import { CalendarCheck2, CalendarX2, ChevronLeft, ChevronRight, ClipboardCheck, UserX } from 'lucide-react'
import { api, type User } from '@/api'
import { type Bar, Donut, type Series, StackedBars } from '@/components/charts'
import { Card, Empty } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { useLoad } from '@/lib/hooks'

type Range = 'week' | 'month'

const DONE = '#10b981'
const MISSED = '#f43f5e'
const CANCELLED = '#f59e0b'

const SERIES: Series[] = [
  { key: 'COMPLETED', label: 'Completed', color: DONE },
  { key: 'MISSED', label: 'Missed', color: MISSED },
  { key: 'CANCELLED', label: 'Cancelled', color: CANCELLED },
  { key: 'SCHEDULED', label: 'Scheduled', color: 'var(--c-brand-soft)' },
]

/** The viewer's local calendar window: Monday to Sunday, or the calendar month, `offset` periods from now. */
function windowFor(range: Range, offset: number) {
  const today = new Date()
  if (range === 'week') {
    const from = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - ((today.getDay() + 6) % 7) + offset * 7,
    )
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 23, 59, 59, 999)
    return { from, to }
  }
  const from = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999) }
}

const fmtRange = (range: Range, from: Date, to: Date) =>
  range === 'month'
    ? from.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : `${from.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')

/** The hospital admin's home: how many appointments were completed, missed or cancelled this week or month. */
export function HospitalOverview({ user }: { user: User }) {
  const [range, setRange] = useState<Range>('week')
  const [offset, setOffset] = useState(0)
  const { from, to } = windowFor(range, offset)
  const [stats] = useLoad(() => api.stats(from, to), [range, offset])

  const t = stats?.totals ?? {}
  const completed = t.COMPLETED ?? 0
  const missed = t.MISSED ?? 0
  const cancelled = t.CANCELLED ?? 0
  const finished = completed + missed + cancelled
  const scheduled = (t.CONFIRMED ?? 0) + (t.ARRIVED ?? 0) + (t.PENDING_PAYMENT ?? 0)

  const bars: Bar[] = (stats?.days ?? []).map((d) => {
    const date = new Date(`${d.date}T12:00:00`)
    return {
      label:
        range === 'week'
          ? date.toLocaleDateString([], { weekday: 'short' })
          : date.toLocaleDateString([], { weekday: 'narrow' }),
      sub: String(date.getDate()),
      values: {
        COMPLETED: d.counts.COMPLETED ?? 0,
        MISSED: d.counts.MISSED ?? 0,
        CANCELLED: d.counts.CANCELLED ?? 0,
        SCHEDULED: (d.counts.CONFIRMED ?? 0) + (d.counts.ARRIVED ?? 0) + (d.counts.PENDING_PAYMENT ?? 0),
      },
    }
  })

  const kpis = [
    { label: 'Appointments', value: stats?.total ?? 0, hint: 'in this period', icon: ClipboardCheck },
    { label: 'Completed', value: completed, hint: pct(completed, finished) + ' of finished', icon: CalendarCheck2 },
    { label: 'Missed', value: missed, hint: pct(missed, finished) + ' of finished', icon: UserX },
    { label: 'Cancelled', value: cancelled, hint: pct(cancelled, finished) + ' of finished', icon: CalendarX2 },
  ]

  return (
    <div className="space-y-5">
      <section className="relative isolate overflow-hidden rounded-[32px] bg-brand p-6 text-white sm:p-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--c-brand)_50%,white)_0%,transparent_55%),radial-gradient(90%_80%_at_0%_100%,var(--c-brand-deep)_0%,transparent_70%)]" />
        <div className="absolute inset-0 -z-10 opacity-[0.1] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom_right,black,transparent_70%)]" />
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">
              {user.hospital?.name ?? 'Your hospital'}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Appointment statistics</h2>
            <p className="mt-1 text-sm text-white/75">How your appointments ended, day by day.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-1 rounded-full bg-white/15 p-1 backdrop-blur" role="tablist" aria-label="Period">
              {(['week', 'month'] as const).map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => {
                    setRange(r)
                    setOffset(0)
                  }}
                  className={cx(
                    'h-9 rounded-full px-5 text-xs font-bold capitalize transition',
                    range === r ? 'bg-white text-brand' : 'text-white/85 hover:bg-white/10',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-sm font-semibold">
              <button
                aria-label={`Previous ${range}`}
                onClick={() => setOffset((o) => o - 1)}
                className="grid size-9 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-40 text-center">{fmtRange(range, from, to)}</span>
              <button
                aria-label={`Next ${range}`}
                disabled={offset >= 0}
                onClick={() => setOffset((o) => o + 1)}
                className="grid size-9 place-items-center rounded-full bg-white/15 transition hover:bg-white/25 disabled:opacity-40 disabled:hover:bg-white/15"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[22px] bg-white/20 backdrop-blur lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="bg-white/10 p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70">
                <k.icon className="size-3.5" />
                {k.label}
              </div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{stats ? k.value : '–'}</div>
              <div className="text-[11px] text-white/65">{k.hint}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card className="p-5 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <h3 className="text-lg font-bold">Appointments per day</h3>
            <ul className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-muted">
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
          {stats && stats.total === 0 ? (
            <Empty>No appointments in this period.</Empty>
          ) : (
            <StackedBars bars={bars} series={SERIES} height={270} className="text-ink" />
          )}
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="text-lg font-bold">How they ended</h3>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row xl:flex-col">
            <Donut
              slices={[
                { key: 'c', label: 'Completed', value: completed, color: DONE },
                { key: 'm', label: 'Missed', value: missed, color: MISSED },
                { key: 'x', label: 'Cancelled', value: cancelled, color: CANCELLED },
              ]}
              center={pct(completed, finished)}
              caption="completed"
            />
            <ul className="w-full flex-1 space-y-2 text-sm">
              {[
                ['Completed', completed, DONE],
                ['Missed', missed, MISSED],
                ['Cancelled', cancelled, CANCELLED],
              ].map(([label, n, color]) => (
                <li key={label as string} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: color as string }} />
                  <span className="flex-1 text-muted">{label}</span>
                  <b className="tabular-nums">{n as number}</b>
                  <span className="w-10 text-right text-xs text-muted">{pct(n as number, finished)}</span>
                </li>
              ))}
              <li className="flex items-center gap-2 border-t border-ink/5 pt-2 text-xs text-muted">
                <span className="flex-1">Still to come or in progress</span>
                <b className="text-ink">{scheduled}</b>
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  )
}
