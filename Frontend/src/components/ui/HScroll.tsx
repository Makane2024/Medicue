import { type ReactNode, useEffect, useRef } from 'react'
import { cx } from '@/lib/classNames'

/**
 * A row that scrolls sideways without a visible scrollbar: touch swipes natively, a mouse drags it, and the
 * wheel (or a trackpad's vertical swipe) moves it left and right while the pointer is over it. Once it hits either
 * end the wheel goes back to scrolling the page, so it never traps the user.
 */
export function HScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const mark = () => {
      if (el.dataset.hscroll !== 'dragging') el.dataset.hscroll = el.scrollWidth > el.clientWidth + 1 ? 'scrollable' : ''
    }
    const resize = new ResizeObserver(mark)
    resize.observe(el)
    for (const child of Array.from(el.children)) resize.observe(child)
    mark()

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // a sideways gesture already scrolls natively
      const canScrollSideways = el.scrollWidth > el.clientWidth + 1
      const canScrollDown = el.scrollHeight > el.clientHeight + 1
      if (!canScrollSideways || canScrollDown) return
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0
      if (atStart || atEnd) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }

    let startX = 0
    let startLeft = 0
    let pressed = false
    let dragged = false
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return // touch and pen scroll natively
      pressed = true
      dragged = false
      startX = e.clientX
      startLeft = el.scrollLeft
    }
    const onMove = (e: PointerEvent) => {
      if (!pressed) return
      const dx = e.clientX - startX
      if (!dragged && Math.abs(dx) > 5) {
        dragged = true
        el.dataset.hscroll = 'dragging'
      }
      if (dragged) el.scrollLeft = startLeft - dx
    }
    const onUp = () => {
      if (!pressed) return
      pressed = false
      if (dragged) {
        el.dataset.hscroll = 'scrollable'
        setTimeout(() => (dragged = false), 0) // after the click that ends a drag has been swallowed
      }
    }
    const onClick = (e: MouseEvent) => {
      if (dragged) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      resize.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return (
    <div ref={ref} className={cx('no-scrollbar overflow-x-auto', className)}>
      {children}
    </div>
  )
}
