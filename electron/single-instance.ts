// Bezel is one window per machine. Clicking the shortcut again reaches the window that already
// exists instead of building a second, complete instance beside it.
//
// The accumulation this prevents is not cosmetic. Each instance is 5 processes and its own pty
// host, they share one userData profile, and a stuck one is INVISIBLE by construction: the
// window is created `show: false` and only shown on `ready-to-show`, so a renderer that never
// paints leaves a window nobody can see or close. On 2026-08-12 two of those sat for ~45
// minutes while every fresh click added another, and the Electron log filled with
// `Unable to move the cache: Access is denied` from the contention.

/** The slice of BrowserWindow this needs — so the reveal logic is testable without Electron. */
export interface RevealableWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  show(): void
  restore(): void
  focus(): void
}

/**
 * Bring the existing window to the user, whatever state it is in.
 *
 * `show()` is not redundant with `restore()`. Restore un-minimizes; it does nothing for a
 * window that was never shown in the first place, which is the exact state that motivated
 * this feature — and the state in which the user cannot reach the window by any other means.
 */
export function revealWindow(win: RevealableWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}
