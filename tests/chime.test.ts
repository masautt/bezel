import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { chimeEnabled, setChimeEnabled, playChime } from '../client/src/chime'

describe('chime preference', () => {
  beforeEach(() => localStorage.clear())

  it('is on by default, so a fresh profile still gets a sound', () => {
    expect(chimeEnabled()).toBe(true)
  })

  it('round-trips an explicit choice', () => {
    setChimeEnabled(false)
    expect(chimeEnabled()).toBe(false)
    setChimeEnabled(true)
    expect(chimeEnabled()).toBe(true)
  })

  it('falls back to on when storage itself throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    expect(chimeEnabled()).toBe(true)
    get.mockRestore()
  })

  it('swallows a failing write rather than breaking the settings row', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setChimeEnabled(false)).not.toThrow()
    set.mockRestore()
  })
})

describe('playChime', () => {
  afterEach(() => {
    delete (window as { AudioContext?: unknown }).AudioContext
    localStorage.clear()
  })

  // jsdom has no WebAudio at all, which is exactly the environment the guard
  // exists for: a bell must never throw out through React's event handler.
  it('does nothing, loudly or otherwise, where there is no WebAudio', () => {
    expect(() => playChime()).not.toThrow()
  })

  it('does not build an AudioContext when the preference is off', () => {
    const Ctor = vi.fn()
    ;(window as { AudioContext?: unknown }).AudioContext = Ctor
    setChimeEnabled(false)
    playChime()
    expect(Ctor).not.toHaveBeenCalled()
  })
})
