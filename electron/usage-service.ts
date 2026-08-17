import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
// A relative import, not the `@shared` alias — see the note in specs-service.ts:
// tsc does not rewrite path-mapped specifiers on emit.
import { parseUsage } from '../src/usage.js'
import type { UsageSnapshot } from '../src/usage.js'

/**
 * The plan-limit endpoint Claude Code's own `/usage` reads. Bearer-authorized
 * with the OAuth access token already on this machine.
 *
 * The token stays in MAIN. The renderer receives the parsed percentages and
 * nothing else — a credential exposed on the bridge would be reachable from any
 * script that ever runs in that window.
 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

/** Long enough that a gutter meter costs one request a minute at most, short
 *  enough that the number moves while you watch a long run. */
export const CACHE_MS = 60_000
const TIMEOUT_MS = 6_000

/**
 * The stored OAuth credential, or null.
 *
 * Windows keeps it in a plain file under ~/.claude; macOS keeps it in the
 * Keychain, where this finds nothing — which is why every failure here is a
 * quiet null rather than a throw. The meter says "unavailable" on that
 * platform instead of the app breaking on it.
 */
export function readAccessToken(home: string): string | null {
  try {
    const raw = readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } }
    const token = parsed?.claudeAiOauth?.accessToken
    return typeof token === 'string' && token !== '' ? token : null
  } catch {
    return null
  }
}

let cached: { at: number; snapshot: UsageSnapshot | null } | null = null
/** De-dupes concurrent callers onto one request. Two widgets mounting in the
 *  same frame must not each open a socket. */
let inFlight: Promise<UsageSnapshot | null> | null = null

/** Where the last good snapshot is parked between runs. */
let diskPath: string | null = null

/**
 * Point the service at a place to remember the last snapshot, and load whatever
 * is already there.
 *
 * The meter used to read "reading…" for the first several seconds of every
 * launch, which is most of the time anyone looks at it: the request cannot even
 * start until main is out of its synchronous pty spawns, and then it is a real
 * network round-trip with a 6s timeout behind it. A snapshot from the last run
 * is not current, but it is within a few percent of current and it is on screen
 * in the first frame — and `fetchUsage` below revalidates it immediately.
 *
 * Called once from main with `app.getPath('userData')`. Never throws: a missing
 * or corrupt file just means the old behaviour.
 */
export function initUsageCache(userDataDir: string): void {
  diskPath = path.join(userDataDir, 'usage-cache.json')
  try {
    const raw = JSON.parse(readFileSync(diskPath, 'utf-8')) as { at?: unknown; snapshot?: unknown }
    // A persisted FAILURE is not worth restoring: "unavailable" is the one
    // answer that costs nothing to re-derive and is actively misleading if the
    // reason it failed last time (offline, expired token) has since gone away.
    if (typeof raw?.at === 'number' && raw.snapshot) {
      cached = { at: raw.at, snapshot: raw.snapshot as UsageSnapshot }
    }
  } catch {
    // No file yet, or unreadable. Both mean "start cold", which is correct.
  }
}

function persist(at: number, snapshot: UsageSnapshot | null): void {
  if (!diskPath || !snapshot) return
  try {
    writeFileSync(diskPath, JSON.stringify({ at, snapshot }))
  } catch {
    // A cache that cannot be written is not worth a word to anyone; the meter
    // works, it just starts cold next time.
  }
}

async function request(home: string, nowMs: number): Promise<UsageSnapshot | null> {
  const token = readAccessToken(home)
  if (!token) return null
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
      },
      // Without this a hung socket would leave `inFlight` pending forever and
      // every later poll would await that same dead promise.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // An expired token 401s here. Claude Code refreshes it on its own schedule,
    // so the next poll after that refresh simply succeeds — nothing to do but
    // report unavailable in the meantime.
    if (!res.ok) return null
    return parseUsage(await res.json(), new Date(nowMs).toISOString())
  } catch {
    return null
  }
}

/**
 * The current snapshot, cached for CACHE_MS.
 *
 * A failed poll advances the cache CLOCK but never the VALUE: an offline
 * machine or a Keychain platform would otherwise re-attempt on every poll from
 * every window, and the answer would not change any faster for it — but neither
 * is a reason to throw away a reading taken sixty seconds ago. `null` therefore
 * means one thing only: no reading has ever been taken.
 *
 * Stale-while-revalidate past that window: an EXPIRED snapshot is returned
 * immediately and the refresh runs behind it, so a caller never waits on the
 * network for a number it already has a near answer to. The renderer polls every
 * CACHE_MS, so "immediately, one poll behind" is the worst this can be — versus
 * a blocking round-trip that showed "reading…" on every single launch. A caller
 * with NO cached value at all still awaits the real request: there is nothing
 * honest to hand it in the meantime.
 */
export function fetchUsage(home: string, nowMs = Date.now()): Promise<UsageSnapshot | null> {
  const fresh = cached != null && nowMs - cached.at < CACHE_MS
  if (fresh) return Promise.resolve(cached!.snapshot)

  const refresh = inFlight ?? (inFlight = request(home, nowMs)
    .then(snapshot => {
      // A failed poll is not evidence that usage is unknown — it is evidence
      // that THIS poll failed. Keep the last good reading and let its own
      // `fetchedAt` say how old it is; only the cache CLOCK moves, so a dead
      // token is still not retried more than once per CACHE_MS. This is what
      // `persist` and `initUsageCache` already do on disk (neither will let a
      // failure displace a real answer); the in-memory cache was the one layer
      // where a single 401 during a token refresh blanked the meter.
      const kept = snapshot ?? cached?.snapshot ?? null
      cached = { at: nowMs, snapshot: kept }
      if (snapshot) persist(nowMs, snapshot)
      return kept
    })
    .finally(() => { inFlight = null }))

  return cached ? Promise.resolve(cached.snapshot) : refresh
}

/** Test seam: drops the cache so a case can assert the next call really fetches. */
export function resetUsageCache(): void {
  cached = null
  inFlight = null
  diskPath = null
}
