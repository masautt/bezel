import { describe, it, expect, vi } from 'vitest'
import { revealWindow } from '../electron/single-instance'

// A second launch has to reach the window the FIRST launch created, whatever state it is in.
// The state that matters most here is the one that caused this feature to exist: a window that
// was created but never shown, because `createShellWindow` builds it `show: false` and only
// calls `show()` on `ready-to-show`. A renderer that never paints leaves a real window sitting
// invisible, and the user's next click starts yet another instance instead of finding it.
const fake = (state: { visible?: boolean; minimized?: boolean; destroyed?: boolean } = {}) => ({
  isDestroyed: () => state.destroyed ?? false,
  isVisible: () => state.visible ?? true,
  isMinimized: () => state.minimized ?? false,
  show: vi.fn(),
  restore: vi.fn(),
  focus: vi.fn(),
})

describe('revealWindow', () => {
  it('shows a window that exists but was never made visible', () => {
    const win = fake({ visible: false })
    revealWindow(win)
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('restores a minimized window', () => {
    const win = fake({ minimized: true })
    revealWindow(win)
    expect(win.restore).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('only focuses a window that is already up', () => {
    const win = fake()
    revealWindow(win)
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('restores AND shows a window that is both minimized and hidden', () => {
    const win = fake({ visible: false, minimized: true })
    revealWindow(win)
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
  })

  it('does nothing when there is no window', () => {
    expect(() => revealWindow(null)).not.toThrow()
  })

  // `win` is nulled on 'closed', but a second instance can arrive between the window being
  // destroyed and that handler running. Touching a destroyed BrowserWindow throws.
  it('does not touch a destroyed window', () => {
    const win = fake({ destroyed: true })
    revealWindow(win)
    expect(win.focus).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
  })
})
