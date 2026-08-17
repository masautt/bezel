import { describe, it, expect } from 'vitest'
import { clipboardAction } from '../src/keys.js'

/** The shape TerminalPane hands over, built from a real KeyboardEvent. */
const ev = (over: Partial<Parameters<typeof clipboardAction>[0]> = {}) => ({
  key: 'c', ctrl: true, shift: false, alt: false, hasSelection: false, ...over,
})

describe('clipboardAction', () => {
  it('copies on ctrl+c when there is a selection', () => {
    expect(clipboardAction(ev({ hasSelection: true }))).toBe('copy')
  })

  // The half that matters most: with nothing selected, ctrl+c has to keep
  // meaning "interrupt". Swallowing it would take away the only way to stop a
  // runaway process, which is a worse bug than the one copy support fixes.
  it('passes ctrl+c through when nothing is selected, so interrupt still works', () => {
    expect(clipboardAction(ev({ hasSelection: false }))).toBe('passthrough')
  })

  it('copies on ctrl+shift+c whether or not there is a selection', () => {
    expect(clipboardAction(ev({ shift: true, key: 'C', hasSelection: true }))).toBe('copy')
    expect(clipboardAction(ev({ shift: true, key: 'C', hasSelection: false }))).toBe('copy')
  })

  it('pastes on ctrl+v and ctrl+shift+v', () => {
    expect(clipboardAction(ev({ key: 'v' }))).toBe('paste')
    expect(clipboardAction(ev({ key: 'V', shift: true }))).toBe('paste')
  })

  // Shift changes the reported key to uppercase; matching case-sensitively
  // would silently drop every shifted binding.
  it('is case-insensitive about the key', () => {
    expect(clipboardAction(ev({ key: 'C', hasSelection: true }))).toBe('copy')
  })

  it('ignores keys without ctrl', () => {
    expect(clipboardAction(ev({ ctrl: false, hasSelection: true }))).toBe('passthrough')
    expect(clipboardAction(ev({ ctrl: false, key: 'v' }))).toBe('passthrough')
  })

  // Ctrl+Alt+C is AltGr+C on several layouts, which types a character. Claiming
  // it would make bezel eat real input for users who are not on US English.
  it('ignores ctrl+alt combinations', () => {
    expect(clipboardAction(ev({ alt: true, hasSelection: true }))).toBe('passthrough')
    expect(clipboardAction(ev({ alt: true, key: 'v' }))).toBe('passthrough')
  })

  it('leaves every other ctrl combination alone', () => {
    for (const key of ['a', 'd', 'l', 'z', 'x']) {
      expect(clipboardAction(ev({ key, hasSelection: true }))).toBe('passthrough')
    }
  })
})
