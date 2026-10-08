import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { cx } from '@/lib/classNames'
import { darkQuery, type Prefs, setPrefs, usePrefs } from '@/lib/preferences'

export const ACCENTS: [Prefs['accent'], string, string][] = [
  ['blue', 'Ocean', '#3b6be0'],
  ['teal', 'Teal', '#0f9b8e'],
  ['violet', 'Violet', '#7457e0'],
  ['rose', 'Rose', '#e0507a'],
]

const THEMES = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'Automatic', Monitor],
] as const

/** A miniature of the app (sidebar, header, cards) painted in the theme's colours. */
function Miniature({ theme }: { theme: Prefs['theme'] }) {
  const dark = theme === 'dark'
  const half = theme === 'system'
  const paper = (on: boolean) => (on ? 'bg-[#151a2e]' : 'bg-white')
  const Layer = ({ className, on }: { className: string; on: boolean }) => (
    <div className={cx('absolute rounded-lg', className, paper(on))} />
  )
  const Scene = ({ on }: { on: boolean }) => (
    <div className={cx('absolute inset-0 overflow-hidden', on ? 'bg-[#0d1020]' : 'bg-[#dfe4f5]')}>
      <Layer on={on} className="left-2 top-2 bottom-2 w-7 opacity-90" />
      <Layer on={on} className="left-11 right-2 top-2 h-5" />
      <div className="absolute left-11 top-9 h-9 w-14 rounded-lg bg-brand" />
      <Layer on={on} className="left-[6.5rem] right-2 top-9 h-9" />
      <Layer on={on} className="left-11 right-2 bottom-2 h-6" />
    </div>
  )
  return (
    <div className="relative h-24 overflow-hidden rounded-2xl">
      {half ? (
        <>
          <Scene on={false} />
          <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
            <div className="absolute inset-y-0 right-0 w-[200%]">
              <Scene on />
            </div>
          </div>
        </>
      ) : (
        <Scene on={dark} />
      )}
    </div>
  )
}

export function ThemeTiles() {
  const p = usePrefs()
  return (
    <div>
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
        {THEMES.map(([v, label, Icon]) => (
          <button
            key={v}
            role="radio"
            aria-checked={p.theme === v}
            onClick={() => setPrefs({ theme: v })}
            className={cx(
              'group rounded-[22px] p-2 text-left ring-2 transition',
              p.theme === v ? 'bg-brand-soft/40 ring-brand' : 'ring-transparent hover:bg-mist',
            )}
          >
            <Miniature theme={v} />
            <div className="mt-2 flex items-center gap-1.5 px-1 pb-0.5 text-xs font-bold">
              <Icon className="size-3.5" />
              {label}
              {p.theme === v && <Check className="ml-auto size-3.5 text-brand" />}
            </div>
          </button>
        ))}
      </div>
      {p.theme === 'system' && (
        <p className="mt-2 text-[11px] text-muted">
          Follows your device, currently {darkQuery.matches ? 'dark' : 'light'}.
        </p>
      )}
    </div>
  )
}

export function AccentSwatches() {
  const p = usePrefs()
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map(([v, label, color]) => (
        <button
          key={v}
          role="radio"
          aria-checked={p.accent === v}
          onClick={() => setPrefs({ accent: v })}
          className={cx(
            'flex items-center gap-2.5 rounded-2xl p-2 pr-3 text-xs font-bold ring-2 transition',
            p.accent === v ? 'bg-mist ring-brand' : 'ring-transparent hover:bg-mist/70',
          )}
        >
          <span
            className="grid size-9 place-items-center rounded-xl text-white shadow-[inset_0_-6px_12px_rgba(0,0,0,0.12)]"
            style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 70%, black))` }}
          >
            {p.accent === v && <Check className="size-4" />}
          </span>
          {label}
        </button>
      ))}
    </div>
  )
}
