import { describe, it, expect, vi } from 'vitest'
import { createStampCache } from '../electron/stamp-cache'

/**
 * Not re-reading a file that has not changed.
 *
 * The context meter polls every 5s while the window has focus, and each poll
 * reads the last 512KB of a transcript and JSON-parses its way backwards
 * through it — about 8ms against a 10.9MB session. Between claude's turns that
 * file is identical every time, so the whole of that is spent proving nothing
 * changed.
 *
 * Keyed on file identity AND (mtime, size): mtime alone is not enough, because
 * filesystems coarsen it, and an append that lands inside the same tick would
 * then read as unchanged. A transcript only ever grows, so size is the reliable
 * half of the pair.
 */
describe('createStampCache', () => {
  it('computes on the first request', async () => {
    const cache = createStampCache<number>()
    const compute = vi.fn(async () => 42)

    expect(await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)).toBe(42)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('serves an unchanged file without recomputing', async () => {
    const cache = createStampCache<number>()
    const compute = vi.fn(async () => 42)

    await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)
    const again = await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)

    expect(again).toBe(42)
    expect(compute, 'the file did not change, so nothing should be re-read').toHaveBeenCalledTimes(1)
  })

  it('recomputes once the file has been written to', async () => {
    const cache = createStampCache<number>()
    let n = 1
    const compute = vi.fn(async () => n++)

    await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)
    const after = await cache.through('a.jsonl', { mtimeMs: 2, size: 20 }, compute)

    expect(after).toBe(2)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  // The reason size is in the key at all: a coarse mtime can survive an append.
  it('recomputes when only the size moved', async () => {
    const cache = createStampCache<number>()
    const compute = vi.fn(async () => 1)

    await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)
    await cache.through('a.jsonl', { mtimeMs: 1, size: 11 }, compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  // And the reverse: a truncate-and-rewrite that lands on the same size.
  it('recomputes when only the mtime moved', async () => {
    const cache = createStampCache<number>()
    const compute = vi.fn(async () => 1)

    await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)
    await cache.through('a.jsonl', { mtimeMs: 2, size: 10 }, compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  // Switching tabs points the meter at another session's transcript. Serving
  // the previous tab's reading for it would be the same bug the sessionId
  // lookup exists to fix.
  it('never serves one file’s reading for another', async () => {
    const cache = createStampCache<string>()
    const compute = vi.fn(async () => 'b-reading')

    await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, async () => 'a-reading')
    const b = await cache.through('b.jsonl', { mtimeMs: 1, size: 10 }, compute)

    expect(b).toBe('b-reading')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  // null is a real answer — a transcript with no assistant turn yet — and the
  // most important one to cache: recomputing it means re-reading 512KB every
  // 5s to conclude nothing again.
  it('caches a null reading like any other', async () => {
    const cache = createStampCache<number | null>()
    const compute = vi.fn(async () => null)

    expect(await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)).toBeNull()
    await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)

    expect(compute).toHaveBeenCalledTimes(1)
  })

  // A throw must not be remembered: the next poll has to be free to try again.
  it('does not cache a computation that threw', async () => {
    const cache = createStampCache<number>()
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(7)

    await expect(cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)).rejects.toThrow('read failed')
    expect(await cache.through('a.jsonl', { mtimeMs: 1, size: 10 }, compute)).toBe(7)
  })
})
