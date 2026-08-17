import { useCallback } from 'react'

export interface DividerProps {
  /** 'horizontal' (default) trades height between stacked siblings;
   *  'vertical' trades width between side-by-side ones. */
  orientation?: 'horizontal' | 'vertical'
  /** Selector of the ancestor whose size normalizes the delta. Default '.grid'. */
  measure?: string
  /**
   * Both units, every drag. Gutter widths are pixels and slot/pane heights are
   * fractions; handing over both stops each caller re-measuring the ancestor
   * that this component has already measured.
   */
  onDrag: (deltaRatio: number, deltaPx: number) => void
  /** Double-click. Restores this one dimension to its default. */
  onReset?: () => void
}

export function Divider({ orientation = 'horizontal', measure, onDrag, onReset }: DividerProps) {
  const vertical = orientation === 'vertical'

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    // The draggable region is the named ancestor — `.grid` (the app minus the
    // 32px app bar) by default, or a `.gutter` for the widget grabbers. NOT the
    // window: dividing by window.innerHeight overshoots by the app-bar height
    // and the drag stops tracking the cursor exactly.
    const container = e.currentTarget.closest<HTMLElement>(measure ?? '.grid')
    const extent = (vertical ? container?.clientWidth : container?.clientHeight)
      || (vertical ? window.innerWidth : window.innerHeight)
    let last = vertical ? e.clientX : e.clientY
    const move = (ev: PointerEvent) => {
      const now = vertical ? ev.clientX : ev.clientY
      const delta = now - last
      onDrag(delta / extent, delta)
      last = now
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [measure, onDrag, vertical])

  return (
    <div
      className={`divider${vertical ? ' divider-v' : ''}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
    />
  )
}
