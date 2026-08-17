import { useEffect, useRef } from 'react'

export interface TabShortcutHandlers {
  onNew(): void
  /** Arms the two-step close on the active tab. Never closes outright. */
  onCloseIntent(): void
  onNext(): void
  onPrev(): void
  /** Zero-based: Ctrl+1 passes 0. */
  onIndex(index: number): void
}

/**
 * Tab keyboard shortcuts, bound once on `window` at CAPTURE phase so they are
 * seen before xterm's own key handling forwards the keystroke to the pty.
 * Only the five claimed combinations are intercepted; everything else falls
 * through untouched.
 *
 * The shifted forms are deliberate. Bare Ctrl+W is backward-kill-word and bare
 * Ctrl+T is transpose-char in PSReadLine — claiming them would break real
 * line-editing keys inside the shell. Windows Terminal avoids this the same
 * way. Ctrl+Tab and Ctrl+1..9 have no PSReadLine binding and are safe to take.
 */
export function useTabShortcuts(handlers: TabShortcutHandlers): void {
  // A ref, so the listener is bound exactly once no matter how often the
  // caller re-renders with fresh closures.
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const h = ref.current
      const key = e.key.toLowerCase()

      let handled = true
      if (e.shiftKey && key === 't') h.onNew()
      else if (e.shiftKey && key === 'w') h.onCloseIntent()
      else if (key === 'tab') {
        if (e.shiftKey) h.onPrev()
        else h.onNext()
      } else if (!e.shiftKey && /^[1-9]$/.test(e.key)) h.onIndex(Number(e.key) - 1)
      else handled = false

      if (!handled) return
      // Only now — an unclaimed keystroke must reach the terminal intact.
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
