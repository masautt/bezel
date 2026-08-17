import { useEffect, useRef } from 'react'

/**
 * Ctrl+, opens settings.
 *
 * Bound on `window` at CAPTURE phase, exactly as `useTabShortcuts` does, so it
 * is seen before xterm forwards the keystroke to the pty. This app has one
 * global-key mechanism and must not grow a second with different semantics.
 *
 * Ctrl+, is the conventional settings key and has no PSReadLine binding, so
 * claiming it costs no real line-editing key — the same test the tab shortcuts
 * applied when they took the shifted forms of Ctrl+T and Ctrl+W.
 */
export function useSettingsShortcut(onOpen: () => void): void {
  // A ref so the listener binds once regardless of how often the caller
  // re-renders with a fresh closure.
  const ref = useRef(onOpen)
  ref.current = onOpen

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (e.key !== ',') return
      ref.current()
      // Only for the claimed combination — anything else must reach the
      // terminal intact.
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
