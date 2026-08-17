import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useTabShortcuts, type TabShortcutHandlers } from '../client/src/useTabShortcuts'

function handlers(): TabShortcutHandlers {
  return { onNew: vi.fn(), onCloseIntent: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onIndex: vi.fn() }
}

let h: TabShortcutHandlers

function Probe() {
  useTabShortcuts(h)
  return null
}

/** Dispatch on document so the window-level capture listener sees it. */
function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  document.dispatchEvent(event)
  return event
}

beforeEach(() => { h = handlers() })

describe('useTabShortcuts', () => {
  it('Ctrl+Shift+T opens a new tab', () => {
    render(<Probe />)
    const e = press({ key: 'T', ctrlKey: true, shiftKey: true })
    expect(h.onNew).toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
  })

  it('Ctrl+Shift+W arms a close rather than closing', () => {
    render(<Probe />)
    press({ key: 'W', ctrlKey: true, shiftKey: true })
    expect(h.onCloseIntent).toHaveBeenCalled()
  })

  it('Ctrl+Tab and Ctrl+Shift+Tab move between tabs', () => {
    render(<Probe />)
    press({ key: 'Tab', ctrlKey: true })
    press({ key: 'Tab', ctrlKey: true, shiftKey: true })
    expect(h.onNext).toHaveBeenCalledTimes(1)
    expect(h.onPrev).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+1..9 jump by zero-based index', () => {
    render(<Probe />)
    press({ key: '1', ctrlKey: true })
    press({ key: '9', ctrlKey: true })
    expect(h.onIndex).toHaveBeenNthCalledWith(1, 0)
    expect(h.onIndex).toHaveBeenNthCalledWith(2, 8)
  })

  it('leaves shell editing keys alone', () => {
    render(<Probe />)
    // Bare Ctrl+W is backward-kill-word and Ctrl+T is transpose in PSReadLine.
    for (const key of ['w', 't', 'a', 'c']) {
      const e = press({ key, ctrlKey: true })
      expect(e.defaultPrevented).toBe(false)
    }
    // Ctrl+0 is not a tab shortcut either.
    expect(press({ key: '0', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(h.onNew).not.toHaveBeenCalled()
    expect(h.onCloseIntent).not.toHaveBeenCalled()
    expect(h.onIndex).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', () => {
    const view = render(<Probe />)
    view.unmount()
    press({ key: 'T', ctrlKey: true, shiftKey: true })
    expect(h.onNew).not.toHaveBeenCalled()
  })
})
