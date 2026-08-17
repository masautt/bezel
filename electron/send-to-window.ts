// Delivering to a window that may already be gone.
//
// main streams every byte of pty output to the renderer, and the obvious
// `win?.webContents.send(…)` covers exactly one case — `win` set to null by the
// `closed` handler — and misses the one that actually happens.
//
// webContents is destroyed BEFORE `closed` fires, and the pty host goes on
// streaming through the 500ms window that `before-quit` deliberately holds open
// to reap the pwsh/conpty grandchildren. `send` on a destroyed webContents
// throws; that throw lands on the main thread mid-shutdown, where it reads as a
// clean exit and orphans the very grandchildren the wait exists to kill.

/**
 * The part of `BrowserWindow` this needs. Structural rather than the Electron
 * type so a test can pass a plain object — `BrowserWindow` cannot be
 * constructed under vitest.
 */
export interface SendTarget {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send(channel: string, ...args: unknown[]): void
  }
}

export function sendToWindow(win: SendTarget | null, channel: string, ...args: unknown[]): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  try {
    win.webContents.send(channel, ...args)
  } catch {
    // The guards above are a check followed by an act, which is only safe while
    // both stay synchronous — and Electron has torn a webContents down inside a
    // send before. A dropped frame of terminal output is not worth the process.
  }
}
