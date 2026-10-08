import { cx } from '@/lib/classNames'

// Small dependency-free SVG charts. Colours are CSS colours so they follow the theme and accent.

export interface Series {
  key: string
  label: string
  color: string
}

export interface Bar {
  label: string
  /** Second line under the label (for example the day number). */
  sub?: string
  values: Record<string, number>
}

// the top of the axis: four whole-number steps, so every grid line has a whole-number label
const STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500, 1000]
const niceMax = (n: number) => 4 * (STEPS.find((s) => s * 4 >= n) ?? Math.ceil(n / 4))

/** Stacked columns, one per bar, with a few grid lines. Every column has a text alternative. */
export function StackedBars({
  bars,
  series,
  height = 220,
  className,
}: {
  bars: Bar[]
  series: Series[]
  height?: number
  className?: string
}) {
  const W = 640
  const pad = { l: 30, r: 6, t: 8, b: 34 }
  const innerW = W - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const totals = bars.map((b) => series.reduce((s, x) => s + (b.values[x.key] ?? 0), 0))
  const max = niceMax(Math.max(0, ...totals))
  const slot = innerW / Math.max(bars.length, 1)
  const barW = Math.min(34, slot * 0.62)
  const every = bars.length > 14 ? Math.ceil(bars.length / 10) : 1
  const grid = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      role="img"
      aria-label={`Appointments per day: ${bars.map((b, i) => `${b.label} ${b.sub ?? ''} ${totals[i]}`).join(', ')}`}
      className={cx('w-full', className)}
    >
      {grid.map((g) => {
        const y = pad.t + innerH * (1 - g)
        return (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="currentColor" strokeOpacity={g === 0 ? 0.25 : 0.08} />
            <text x={pad.l - 6} y={y + 3.5} textAnchor="end" className="fill-muted text-[10px]">
              {Math.round(max * g)}
            </text>
          </g>
        )
      })}
      {bars.map((b, i) => {
        const x = pad.l + slot * i + (slot - barW) / 2
        let y = pad.t + innerH
        return (
          <g key={i}>
            <title>{`${b.label} ${b.sub ?? ''}: ${series.map((s) => `${b.values[s.key] ?? 0} ${s.label.toLowerCase()}`).join(', ')}`}</title>
            <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} fill="transparent" />
            {series.map((s) => {
              const v = b.values[s.key] ?? 0
              if (!v) return null
              const h = (v / max) * innerH
              y -= h
              return <rect key={s.key} x={x} y={y} width={barW} height={Math.max(h - 1, 1)} rx={3} fill={s.color} />
            })}
            {i % every === 0 && (
              <text
                x={x + barW / 2}
                y={height - 18}
                textAnchor="middle"
                className="fill-muted text-[10px] font-semibold"
              >
                {b.label}
              </text>
            )}
            {i % every === 0 && b.sub && (
              <text x={x + barW / 2} y={height - 5} textAnchor="middle" className="fill-ink text-[10px] font-bold">
                {b.sub}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** A ring split into slices, with the total (or a chosen figure) in the middle. */
export function Donut({
  slices,
  center,
  caption,
  size = 168,
}: {
  slices: { key: string; label: string; value: number; color: string }[]
  center: string
  caption: string
  size?: number
}) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = 44
  const C = 2 * Math.PI * r
  let offset = 0
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`${caption}: ${center}. ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}
    >
      <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="13" />
      {total > 0 &&
        slices.map((s) => {
          if (!s.value) return null
          const len = (s.value / total) * C
          const el = (
            <circle
              key={s.key}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="13"
              strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
      <text x="60" y="58" textAnchor="middle" className="fill-ink text-[19px] font-extrabold">
        {center}
      </text>
      <text x="60" y="73" textAnchor="middle" className="fill-muted text-[7.5px] font-semibold">
        {caption}
      </text>
    </svg>
  )
}
