// One reading per repo per moment, however many widgets ask for it.
//
// ContextWidget and ChangesWidget each call `useGitInfo(context.root)` on their
// own 10s interval, and both mount together — so the same repo was read twice,
// milliseconds apart, forever. `git:info` had no cache at all, unlike
// `apps:list`, which already caches its promise for exactly this reason.
//
// The window is deliberately far shorter than the widgets' poll interval: this
// exists to collapse simultaneous readers, not to make the Changes list lag
// behind a commit the user just made in the shell pane.
import type { GitInfo } from '../src/types.js'

export interface GitCache {
  get(root: string): Promise<GitInfo | null>
}

interface Entry {
  /** The in-flight or settled load. Cached as a PROMISE, which is what makes
   *  two callers in the same tick share one git process rather than two. */
  promise: Promise<GitInfo | null>
  /** When this entry stops being served. Stamped on completion, not on start,
   *  so a slow read does not immediately expire on arrival. */
  freshUntil: number
}

/**
 * @param load Reads a repo for real.
 * @param now Injected so a TTL is testable without waiting on one.
 * @param ttlMs How long a completed reading may be reused.
 */
export function createGitCache(
  load: (root: string) => Promise<GitInfo | null>,
  now: () => number,
  ttlMs: number,
): GitCache {
  const entries = new Map<string, Entry>()

  return {
    get(root) {
      const hit = entries.get(root)
      // An in-flight entry (freshUntil still 0) is always joined rather than
      // raced; a settled one is served until its window closes.
      if (hit && (hit.freshUntil === 0 || now() < hit.freshUntil)) return hit.promise

      const entry: Entry = { promise: load(root), freshUntil: 0 }
      entries.set(root, entry)

      entry.promise.then(
        () => { entry.freshUntil = now() + ttlMs },
        () => {
          // Never remember a failure. A cached rejected promise would re-throw
          // for the whole window, and nothing later could correct it — so drop
          // the entry and let the next caller try again for real.
          if (entries.get(root) === entry) entries.delete(root)
        },
      )

      return entry.promise
    },
  }
}
