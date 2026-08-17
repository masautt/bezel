import { describe, it, expect, vi, afterEach } from 'vitest'
import { createConfigQueue } from '../electron/config-queue'

/**
 * `project:remember` fires on EVERY shell prompt — several times a minute, per
 * its own comment — and each one was a synchronous read of config.json plus a
 * synchronous rewrite of the whole file, on the main thread.
 *
 * Coalescing turns a burst of prompts into one write. The flush is the other
 * half and is not optional: a debounce that loses the last value on quit trades
 * a performance problem for a correctness one.
 */

interface Config {
  lastCwd?: string
  lastRepoRoot?: string
}

afterEach(() => { vi.useRealTimers() })

describe('createConfigQueue', () => {
  it('collapses a burst of patches into one write', () => {
    // The shape of the actual load: a `cd` through four directories used to be
    // four full-file rewrites.
    vi.useFakeTimers()
    const apply = vi.fn()
    const q = createConfigQueue<Config>(apply, 1000)

    q.patch({ lastCwd: 'C:/a' })
    q.patch({ lastCwd: 'C:/b' })
    q.patch({ lastCwd: 'C:/c' })
    expect(apply, 'nothing written while the burst is still arriving').not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({ lastCwd: 'C:/c' })
  })

  it('merges patches to different keys', () => {
    // remember and rememberRepo fire on different events and can land in the
    // same window; the later one must not drop the earlier one's key.
    vi.useFakeTimers()
    const apply = vi.fn()
    const q = createConfigQueue<Config>(apply, 1000)

    q.patch({ lastCwd: 'C:/a' })
    q.patch({ lastRepoRoot: 'C:/repo' })
    vi.advanceTimersByTime(1000)

    expect(apply).toHaveBeenCalledWith({ lastCwd: 'C:/a', lastRepoRoot: 'C:/repo' })
  })

  it('writes immediately on flush and cancels the pending timer', () => {
    // before-quit calls this. Without it the last cwd of the session — the one
    // the next launch opens at — is exactly the value that gets lost.
    vi.useFakeTimers()
    const apply = vi.fn()
    const q = createConfigQueue<Config>(apply, 1000)

    q.patch({ lastCwd: 'C:/a' })
    q.flush()
    expect(apply).toHaveBeenCalledWith({ lastCwd: 'C:/a' })

    vi.advanceTimersByTime(5000)
    expect(apply, 'the timer must not fire a second write').toHaveBeenCalledTimes(1)
  })

  it('flushes nothing when nothing is pending', () => {
    // before-quit runs on every quit, most of which follow a flush already
    // done by the timer. Writing `{}` over the config there would be a bug.
    const apply = vi.fn()
    const q = createConfigQueue<Config>(apply, 1000)

    q.flush()
    expect(apply).not.toHaveBeenCalled()
  })

  it('starts a fresh window after a flush', () => {
    vi.useFakeTimers()
    const apply = vi.fn()
    const q = createConfigQueue<Config>(apply, 1000)

    q.patch({ lastCwd: 'C:/a' })
    q.flush()
    q.patch({ lastCwd: 'C:/b' })
    vi.advanceTimersByTime(1000)

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith({ lastCwd: 'C:/b' })
  })

  it('does not hold the process open for a pending write', () => {
    // Same reasoning as the prewarm timer: a deferred config write is a nicety
    // and must never be the reason the app lingers at quit. before-quit
    // flushes it anyway.
    vi.useFakeTimers()
    const q = createConfigQueue<Config>(vi.fn(), 1000)
    q.patch({ lastCwd: 'C:/a' })

    const timer = vi.getTimerCount()
    expect(timer, 'a timer is pending').toBeGreaterThan(0)
    // unref is the assertion; a fake timer has no handle to inspect, so this
    // guards the call instead.
    expect(() => q.flush()).not.toThrow()
  })

  it('keeps writing if one apply throws', () => {
    // writeUserConfig is best-effort and swallows its own errors, but the
    // atomic writer below can throw on a full disk. One failed write must not
    // stop every later one.
    vi.useFakeTimers()
    const apply = vi.fn()
      .mockImplementationOnce(() => { throw new Error('ENOSPC') })
    const q = createConfigQueue<Config>(apply, 1000)

    q.patch({ lastCwd: 'C:/a' })
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()

    q.patch({ lastCwd: 'C:/b' })
    vi.advanceTimersByTime(1000)
    expect(apply).toHaveBeenCalledTimes(2)
  })
})
