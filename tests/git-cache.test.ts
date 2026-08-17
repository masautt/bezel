import { describe, it, expect, vi } from 'vitest'
import { createGitCache } from '../electron/git-cache'
import type { GitInfo } from '../src/types'

/**
 * Two widgets ask for the same reading.
 *
 * ContextWidget and ChangesWidget each call `useGitInfo(context.root)` with
 * their own 10s interval, and both mount together — so the same repo was read
 * twice, milliseconds apart, forever. At ~183ms of git per read that is pure
 * duplication, and `git:info` had no cache at all (unlike `apps:list`, which
 * already caches its promise for exactly this reason).
 */

const info = (branch: string): GitInfo => ({ branch, ahead: 0, dirty: [] })

/** A clock the test moves by hand, so a TTL is tested without waiting on one. */
function fakeClock(start = 1_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('createGitCache', () => {
  it('collapses two concurrent reads of one root into a single load', async () => {
    const clock = fakeClock()
    const load = vi.fn(async () => info('main'))
    const cache = createGitCache(load, clock.now, 1500)

    const [a, b] = await Promise.all([cache.get('C:/repo'), cache.get('C:/repo')])

    expect(load).toHaveBeenCalledTimes(1)
    expect(a).toEqual(info('main'))
    expect(b).toEqual(info('main'))
  })

  it('serves a second read from cache while the result is still fresh', async () => {
    const clock = fakeClock()
    const load = vi.fn(async () => info('main'))
    const cache = createGitCache(load, clock.now, 1500)

    await cache.get('C:/repo')
    clock.advance(1000)
    await cache.get('C:/repo')

    expect(load).toHaveBeenCalledTimes(1)
  })

  // The cache exists to collapse two near-simultaneous readers, NOT to slow the
  // widgets down. A poll after the window must see the repo as it is now.
  it('reads again once the entry has gone stale', async () => {
    const clock = fakeClock()
    const load = vi.fn(async () => info('main'))
    const cache = createGitCache(load, clock.now, 1500)

    await cache.get('C:/repo')
    clock.advance(1501)
    await cache.get('C:/repo')

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps separate roots apart', async () => {
    const clock = fakeClock()
    const load = vi.fn(async (root: string) => info(root === 'C:/a' ? 'main' : 'dev'))
    const cache = createGitCache(load, clock.now, 1500)

    expect(await cache.get('C:/a')).toEqual(info('main'))
    expect(await cache.get('C:/b')).toEqual(info('dev'))
    expect(load).toHaveBeenCalledTimes(2)
  })

  // null is a real answer — "not a repo", or unreadable — and worth caching for
  // the window like any other, or a directory that is not a repo would be
  // re-probed twice every ten seconds forever.
  it('caches a null reading like any other', async () => {
    const clock = fakeClock()
    const load = vi.fn(async () => null)
    const cache = createGitCache(load, clock.now, 1500)

    expect(await cache.get('C:/not-a-repo')).toBeNull()
    await cache.get('C:/not-a-repo')

    expect(load).toHaveBeenCalledTimes(1)
  })

  // A rejection must not be remembered. `gitInfo` catches internally today, so
  // this is a guard on the cache rather than on git — but a cached rejected
  // promise would re-throw for the whole window and, worse, never settle into
  // anything a later read could correct.
  it('does not cache a load that threw', async () => {
    const clock = fakeClock()
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('git exploded'))
      .mockResolvedValueOnce(info('main'))
    const cache = createGitCache(load, clock.now, 1500)

    await expect(cache.get('C:/repo')).rejects.toThrow('git exploded')
    expect(await cache.get('C:/repo')).toEqual(info('main'))
    expect(load).toHaveBeenCalledTimes(2)
  })
})
