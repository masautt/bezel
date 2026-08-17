// Not re-reading a file that has not changed.
//
// The context meter polls every 5s while the window has focus, and each poll
// reads the last 512KB of a transcript and JSON-parses backwards through it —
// about 8ms against a 10.9MB session. Between claude's turns that file is byte
// for byte identical, so all of it is spent proving nothing happened. It is a
// small cost, but it is a disk read every five seconds for the life of the app,
// which is not nothing on a laptop.

export interface Stamp {
  mtimeMs: number
  size: number
}

export interface StampCache<T> {
  /**
   * The cached value for `file` at this exact `stamp`, or `compute()`'s answer,
   * remembered against it.
   */
  through(file: string, stamp: Stamp, compute: () => Promise<T>): Promise<T>
}

/**
 * A one-entry cache keyed on a file and the stamp that identifies its contents.
 *
 * One entry, not a map: the meter watches whichever session the ACTIVE tab
 * owns, so there is exactly one file in question at a time. Switching tabs
 * simply misses, which is correct — and a map would have to be evicted on tab
 * close or grow for the life of the session.
 *
 * Both halves of the stamp are load-bearing. mtime alone is not enough because
 * filesystems coarsen it, so an append landing inside the same tick would read
 * as unchanged; size alone is not enough because a rewrite can land on the same
 * length. A transcript only grows, so in practice size is what moves — but the
 * pair is what makes that an observation rather than an assumption.
 */
export function createStampCache<T>(): StampCache<T> {
  let key: string | null = null
  let value: T
  let filled = false

  return {
    async through(file, stamp, compute) {
      const next = `${file}|${stamp.mtimeMs}|${stamp.size}`
      // `filled` rather than a null check on `value`: null is a real reading
      // (a transcript with no assistant turn yet) and the one most worth
      // caching, since recomputing it re-reads 512KB to conclude nothing again.
      if (filled && key === next) return value

      // Awaited before anything is stored, so a throw leaves the previous entry
      // untouched and the next poll is free to try again. Caching a rejection
      // would re-throw for as long as the file sat still.
      const computed = await compute()
      key = next
      value = computed
      filled = true
      return computed
    },
  }
}
