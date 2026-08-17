import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useFullscreenShortcut } from '../client/src/useFullscreenShortcut'

function Probe({ onToggle }: { onToggle: () => void }) {
  useFullscreenShortcut(onToggle)
  return null
}

describe('useFullscreenShortcut', () => {
  const press = (init: Partial<KeyboardEventInit> & { key: string }) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
  }

  it('toggles on a bare F11', () => {
    const onToggle = vi.fn()
    render(<Probe onToggle={onToggle} />)
    press({ key: 'F11' })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('swallows the keystroke it claims', () => {
    // Otherwise xterm also forwards it to the pty as ESC[23~.
    render(<Probe onToggle={vi.fn()} />)
    expect(press({ key: 'F11' }).defaultPrevented).toBe(true)
  })

  it('lets every modified form and every other key through untouched', () => {
    // The panes forward keystrokes to a live shell; a chord that merely starts
    // with F11 belongs to whatever is running in there, not to the window.
    const onToggle = vi.fn()
    render(<Probe onToggle={onToggle} />)
    for (const init of [
      { key: 'F11', ctrlKey: true },
      { key: 'F11', altKey: true },
      { key: 'F11', shiftKey: true },
      { key: 'F11', metaKey: true },
      { key: 'F10' },
      { key: 'F12' },
      // The shell's own function keys, which must keep working in a pane.
      { key: 'F7' },
      { key: 'F8' },
    ]) {
      expect(press(init).defaultPrevented, JSON.stringify(init)).toBe(false)
    }
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('fires ahead of anything bound on the document', () => {
    // Capture phase on `window` is the whole mechanism: xterm listens on its own
    // textarea, deeper in the tree, so a bubble-phase listener would arrive
    // after the pty had already been written to.
    const onToggle = vi.fn()
    const later = vi.fn()
    document.addEventListener('keydown', later)
    render(<Probe onToggle={onToggle} />)
    press({ key: 'F11' })
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()
    document.removeEventListener('keydown', later)
  })

  it('always calls the latest handler without rebinding', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe onToggle={first} />)
    rerender(<Probe onToggle={second} />)
    press({ key: 'F11' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unbinds on unmount', () => {
    const onToggle = vi.fn()
    const { unmount } = render(<Probe onToggle={onToggle} />)
    unmount()
    press({ key: 'F11' })
    expect(onToggle).not.toHaveBeenCalled()
  })
})
