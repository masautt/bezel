/**
 * Coalesces config writes.
 *
 * `project:remember` fires on every shell prompt — several times a minute, per
 * its own comment in main — and each one was a synchronous read of config.json
 * plus a synchronous rewrite of the whole file, on the thread that owns the
 * window's message loop and every pty keystroke.
 *
 * A `cd` through four directories is one write here rather than four, and the
 * value that lands is the last one, which is the only one that was ever going
 * to matter.
 */
export interface ConfigQueue<T> {
  /** Merge a patch in and (re)start the window. */
  patch(p: Partial<T>): void
  /** Write whatever is pending, now. A no-op when nothing is. */
  flush(): void
}

export function createConfigQueue<T>(apply: (patch: Partial<T>) => void, delayMs: number): ConfigQueue<T> {
  let pending: Partial<T> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function write() {
    if (timer) { clearTimeout(timer); timer = null }
    const patch = pending
    pending = null
    if (!patch) return
    try {
      apply(patch)
    } catch {
      // The writer below is best-effort, but a full disk can still throw on the
      // way in. One failed write must not poison the queue for the rest of the
      // session — the next patch schedules a fresh attempt.
    }
  }

  return {
    patch(p) {
      // Merge rather than replace: `remember` and `rememberRepo` fire on
      // different events and can easily land in the same window.
      pending = { ...(pending ?? {}), ...p }
      if (timer) clearTimeout(timer)
      timer = setTimeout(write, delayMs)
      // Node keeps the process alive for a pending timer, and a deferred config
      // write must never be the reason the app lingers at quit — before-quit
      // flushes it explicitly.
      timer.unref?.()
    },
    flush: write,
  }
}
