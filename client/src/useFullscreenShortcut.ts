import { useEffect, useRef } from 'react'

/**
 * F11 toggles true fullscreen.
 *
 * Bound on `window` at CAPTURE phase, the same mechanism `useTabShortcuts` and
 * `useSettingsShortcut` use, so it is seen before xterm forwards the keystroke
 * to the pty — which would otherwise send `ESC[23~` into whatever is running in
 * the pane instead.
 *
 * Nothing in Electron binds F11 for us. Chromium's built-in fullscreen key is a
 * browser-chrome feature that a BrowserWindow does not inherit, and bezel's main
 * process calls `removeAllListeners('before-input-event')` on the webContents to
 * drop electron-ui's Ctrl+R reload binding, which takes any key the shell might
 * otherwise have claimed with it.
 *
 * F11 has no PSReadLine binding — the shell's function keys are F7 (history) and
 * F8 (history search) — so claiming it costs no real line-editing key. Same test
 * the tab shortcuts applied before taking Ctrl+Tab.
 *
 * Bare F11 only. Any modifier falls through: a chord that happens to start with
 * F11 belongs to whatever is running in the pane, not to the window.
 */
export function useFullscreenShortcut(onToggle: () => void): void {
  // A ref so the listener binds once regardless of how often the caller
  // re-renders with a fresh closure.
  const ref = useRef(onToggle)
  ref.current = onToggle

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (e.key !== 'F11') return
      ref.current()
      // Only for the claimed key — anything else must reach the terminal intact.
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
