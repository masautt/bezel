import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useSettingsShortcut } from '../client/src/useSettingsShortcut'

function Probe({ onOpen }: { onOpen: () => void }) {
  useSettingsShortcut(onOpen)
  return null
}

describe('useSettingsShortcut', () => {
  const press = (init: Partial<KeyboardEventInit> & { key: string }) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
  }

  it('opens on Ctrl+,', () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)
    press({ key: ',', ctrlKey: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('swallows the keystroke it claims', () => {
    // Otherwise the comma also reaches the pty and types into the shell.
    render(<Probe onOpen={vi.fn()} />)
    const event = press({ key: ',', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets every unclaimed combination through untouched', () => {
    // The panes forward keystrokes to a live shell; anything not claimed here
    // must arrive intact.
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)
    for (const init of [
      { key: ',' },
      { key: ',', ctrlKey: true, shiftKey: true },
      { key: ',', ctrlKey: true, altKey: true },
      { key: ',', metaKey: true },
      { key: 'a', ctrlKey: true },
    ]) {
      const event = press(init)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('always calls the latest handler without rebinding', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe onOpen={first} />)
    rerender(<Probe onOpen={second} />)
    press({ key: ',', ctrlKey: true })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unbinds on unmount', () => {
    const onOpen = vi.fn()
    const { unmount } = render(<Probe onOpen={onOpen} />)
    unmount()
    press({ key: ',', ctrlKey: true })
    expect(onOpen).not.toHaveBeenCalled()
  })
})
