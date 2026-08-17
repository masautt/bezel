import { useEffect, useState } from 'react'
import type { UsageSnapshot } from '@shared/usage'
import type { ContextMeter } from '@shared/context-meter'

/**
 * Both hooks carry three states, for the reason spelled out in useGitInfo:
 * `undefined` = not read yet, `null` = no reading, and a value = a real answer.
 * A meter seeded at zero would assert an empty context window and an untouched
 * plan limit before either had been read — the two most reassuring claims the
 * widget can make, made at the one moment it knows nothing.
 */

/** Matches usage-service's own cache, so a poll either finds a fresh value or
 *  triggers exactly one request. Anything faster would only re-read the cache. */
const USAGE_MS = 60_000
/** A tail read of one local file. Cheap enough to feel live while a turn runs. */
const CONTEXT_MS = 5_000

/** Both meters poll only while the window has focus — a bezel behind another
 *  window is not being read, and neither a socket nor a file handle should be
 *  spent on it. */
function usePolled<T>(load: () => Promise<T | null>, intervalMs: number, key: string) {
  const [value, setValue] = useState<T | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setValue(undefined)
    const run = () => {
      void load()
        .then(next => { if (alive) setValue(next) })
        .catch(() => { if (alive) setValue(null) })
    }
    run()
    const timer = setInterval(() => { if (document.hasFocus()) run() }, intervalMs)
    // Re-read the moment the window comes back rather than waiting out the
    // remainder of an interval that did not fire while it was blurred — coming
    // back to a stale bar is exactly when the number matters most.
    const onFocus = () => run()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
    // `key` stands in for whatever the loader closes over (the cwd, or nothing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs])

  return value
}

export function useUsage(): UsageSnapshot | null | undefined {
  return usePolled(() => window.bezel.usage.get(), USAGE_MS, 'usage')
}

export function useContextMeter(cwd: string | null, sessionId?: string): ContextMeter | null | undefined {
  return usePolled(
    () => (cwd ? window.bezel.claudeContext.meter(cwd, sessionId) : Promise.resolve(null)),
    CONTEXT_MS,
    // The id is part of the key, not just the loader: switching to a tab whose
    // cwd is identical (two fresh tabs both open at DEFAULT_ROOT) must still
    // re-read, or the gauge keeps showing the previous tab's session.
    `${cwd ?? ''}|${sessionId ?? ''}`
  )
}
