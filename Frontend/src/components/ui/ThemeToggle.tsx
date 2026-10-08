import { Moon, Sun } from 'lucide-react'
import { cx } from '@/lib/classNames'
import { isDark, setPrefs, usePrefs } from '@/lib/preferences'

export function ThemeToggle({ className }: { className?: string }) {
  usePrefs()
  const dark = isDark()
  return (
    <button
      onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={cx(
        'relative grid size-11 place-items-center overflow-hidden rounded-full bg-surface transition hover:text-brand',
        className,
      )}
    >
      <Sun
        className={cx(
          'absolute size-[18px] transition duration-300',
          dark ? 'translate-y-0 rotate-0' : 'translate-y-8 rotate-90',
        )}
      />
      <Moon
        className={cx(
          'absolute size-[18px] transition duration-300',
          dark ? '-translate-y-8 -rotate-90' : 'translate-y-0 rotate-0',
        )}
      />
    </button>
  )
}
