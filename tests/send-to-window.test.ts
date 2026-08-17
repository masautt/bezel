import { describe, it, expect, vi } from 'vitest'
import { sendToWindow, type SendTarget } from '../electron/send-to-window'

/**
 * `main.ts` streams every byte of pty output to the renderer through
 * `win?.webContents.send`. The `?.` covers exactly one case — `win` set to null
 * by the `closed` handler — and misses the one that actually happens.
 *
 * webContents is destroyed BEFORE `closed` fires, and the host goes on streaming
 * through the 500ms window that `before-quit` deliberately holds open to reap
 * the pwsh grandchildren. `send` on a destroyed webContents throws, and main has
 * no uncaughtException handler, so it hard-exits mid-shutdown — which looks like
 * a clean quit and orphans the very grandchildren the wait exists to kill.
 */

function fakeWindow(state: { win?: boolean; wc?: boolean } = {}): SendTarget & { sent: unknown[][] } {
  const sent: unknown[][] = []
  return {
    sent,
    isDestroyed: () => state.win ?? false,
    webContents: {
      isDestroyed: () => state.wc ?? false,
      send: (channel: string, ...args: unknown[]) => { sent.push([channel, ...args]) },
    },
  }
}

describe('sendToWindow', () => {
  it('delivers to a live window', () => {
    const win = fakeWindow()
    sendToWindow(win, 'pty:data', '1:claude', 'hello')
    expect(win.sent).toEqual([['pty:data', '1:claude', 'hello']])
  })

  it('is a no-op once the window is gone', () => {
    expect(() => sendToWindow(null, 'pty:data', '1:claude', 'hello')).not.toThrow()
  })

  it('is a no-op on a destroyed window', () => {
    const win = fakeWindow({ win: true })
    sendToWindow(win, 'pty:data', '1:claude', 'hello')
    expect(win.sent).toEqual([])
  })

  it('is a no-op when webContents is destroyed but the window is not', () => {
    // The real ordering, and the whole reason this helper exists: `closed` has
    // not fired yet, so `win` is still a non-null BrowserWindow whose
    // webContents is already dead.
    const win = fakeWindow({ wc: true })
    sendToWindow(win, 'pty:data', '1:claude', 'hello')
    expect(win.sent).toEqual([])
  })

  it('swallows a send that throws anyway', () => {
    // The guards above are checked and then acted on, which is safe only while
    // both stay synchronous. Electron has torn a webContents down inside a
    // send before; a dropped frame of terminal output is not worth taking the
    // process down for.
    const win: SendTarget = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(() => { throw new Error('Object has been destroyed') }),
      },
    }
    expect(() => sendToWindow(win, 'pty:data', '1:claude', 'hello')).not.toThrow()
  })
})
