import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readAccessToken, fetchUsage, resetUsageCache, CACHE_MS } from '../electron/usage-service'

const HOME = mkdtempSync(join(tmpdir(), 'bezel-usage-'))

function writeCredentials(body: unknown) {
  mkdirSync(join(HOME, '.claude'), { recursive: true })
  writeFileSync(join(HOME, '.claude', '.credentials.json'), JSON.stringify(body), 'utf-8')
}

const BODY = {
  limits: [
    { kind: 'session', percent: 66, severity: 'normal', resets_at: '2026-08-10T03:20:00Z' },
    { kind: 'weekly_all', percent: 56, severity: 'normal', resets_at: '2026-08-12T07:00:00Z' },
  ],
}

const ok = () => ({ ok: true, json: async () => BODY }) as unknown as Response

beforeEach(() => {
  resetUsageCache()
  vi.restoreAllMocks()
  writeCredentials({ claudeAiOauth: { accessToken: 'sk-ant-oat01-test' } })
})
afterAll(() => rmSync(HOME, { recursive: true, force: true }))

describe('readAccessToken', () => {
  it('reads the stored OAuth token', () => {
    expect(readAccessToken(HOME)).toBe('sk-ant-oat01-test')
  })

  // macOS keeps the credential in the Keychain, where this finds nothing — the
  // meter must say "unavailable" rather than the app breaking on that platform.
  it('is null, never a throw, when there is no credential file', () => {
    expect(readAccessToken(join(HOME, 'nope'))).toBeNull()
  })

  it('is null for a file that is not the shape it expects', () => {
    writeCredentials({ somethingElse: true })
    expect(readAccessToken(HOME)).toBeNull()
    writeFileSync(join(HOME, '.claude', '.credentials.json'), 'not json', 'utf-8')
    expect(readAccessToken(HOME)).toBeNull()
  })
})

describe('fetchUsage', () => {
  it('authorizes with the stored token and parses the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    const snapshot = await fetchUsage(HOME, 1_000)

    expect(snapshot!.session!.percent).toBe(66)
    expect(snapshot!.weekly!.percent).toBe(56)
    const [, init] = fetchSpy.mock.calls[0]
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-ant-oat01-test')
  })

  it('serves the cache inside the window, so a poll is not a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    await fetchUsage(HOME, 1_000)
    await fetchUsage(HOME, 1_000 + CACHE_MS - 1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('refetches once the cache has expired', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    await fetchUsage(HOME, 1_000)
    await fetchUsage(HOME, 1_000 + CACHE_MS)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  // Two widgets mounting in the same frame must not each open a socket.
  it('collapses concurrent callers onto one request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    const [a, b] = await Promise.all([fetchUsage(HOME, 1_000), fetchUsage(HOME, 1_000)])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('never calls out at all without a credential', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    expect(await fetchUsage(join(HOME, 'nope'), 1_000)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // An expired token 401s here; Claude Code refreshes it on its own schedule, so
  // the next poll after that refresh simply succeeds.
  it('is null on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response)
    expect(await fetchUsage(HOME, 1_000)).toBeNull()
  })

  it('is null, never a rejection, when the request itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await expect(fetchUsage(HOME, 1_000)).resolves.toBeNull()
  })

  // An offline machine would otherwise re-attempt on every poll, and the answer
  // would not come any faster for it.
  it('caches a failure too', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await fetchUsage(HOME, 1_000)
    await fetchUsage(HOME, 2_000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

/** An expired OAuth token. claude-code refreshes on its own schedule, so this is
 *  a normal few seconds of every day rather than an error state. */
const unauthorized = () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response

/** Lets the revalidation behind a stale-while-revalidate read actually land. */
const flush = () => new Promise(resolve => setImmediate(resolve))

describe('fetchUsage when a poll fails', () => {
  it('keeps the last good reading rather than going blank', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    const first = await fetchUsage(HOME, 1_000)
    expect(first!.session!.percent).toBe(66)

    // Stale-while-revalidate hands back the good value straight away and
    // refreshes behind it, so the failure lands in the cache a tick later —
    // which makes the NEXT poll the one that used to go blank.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorized())
    await fetchUsage(HOME, 1_000 + CACHE_MS)
    await flush()

    const after = await fetchUsage(HOME, 1_000 + CACHE_MS + 1)
    expect(after!.session!.percent).toBe(66)
    // And it still reports the age of the reading it actually has, so the
    // widget can say how stale it is rather than implying it is current.
    expect(after!.fetchedAt).toBe(first!.fetchedAt)
  })

  it('is still null when the very first poll fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorized())
    expect(await fetchUsage(HOME, 1_000)).toBeNull()
  })

  it('still backs off for CACHE_MS, so a dead token is not polled every frame', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    await fetchUsage(HOME, 1_000)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorized())
    await fetchUsage(HOME, 1_000 + CACHE_MS)
    await flush()
    const afterFailure = fetchSpy.mock.calls.length

    await fetchUsage(HOME, 1_000 + CACHE_MS + 1)
    expect(fetchSpy.mock.calls.length).toBe(afterFailure)
  })
})
