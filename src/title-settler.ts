import { cleanTitle } from './tabs'

/**
 * How long a title must hold before it becomes a tab's label.
 *
 * Sized against what a pane actually reports (see the trace in
 * tests/title-settler.test.ts): claude parks its conversation summary in the
 * terminal title and leaves it there, but every `npm`/`git`/`cargo` the Bash
 * tool runs overwrites the title with its own command line for the length of
 * the run, then the summary comes back. A few seconds is longer than those
 * transients live and far shorter than a real task, which is the entire
 * discrimination this module makes.
 *
 * The cost of raising it is lag on a genuine task change; the cost of lowering
 * it is `npm test` in the tab strip.
 */
export const DWELL_MS = 5000

/** Committed to the tabs reducer once a title has held for `DWELL_MS`. */
export type CommitTitle = (tabId: number, title: string) => void

export interface TitleSettler {
  /** Feed a raw terminal title. Cleaned, then put on the clock. */
  propose: (tabId: number, rawTitle: string) => void
  /** Forget a closed tab: its pending title must not land on a reused id. */
  forget: (tabId: number) => void
  /** Cancel everything in flight. */
  dispose: () => void
}

/**
 * Debounces terminal titles into tab labels.
 *
 * Deliberately NOT part of the tabs reducer: `setTabTitle` and its neighbours
 * are pure, and React may run an updater more than once — a timer started
 * inside one would be started twice. This owns the timers, and calls the
 * reducer only when a title has earned it.
 *
 * The rule is "last title standing", not "first title seen": a candidate is
 * held, and any DIFFERENT title replaces it and restarts the clock. A command
 * that runs for two seconds never outlives its own dwell, so it is never
 * committed, whoever wrote it and whatever it says. That is why there is no
 * list of command names here to keep up to date.
 */
export function createTitleSettler(commit: CommitTitle): TitleSettler {
  const pending = new Map<number, { title: string; timer: ReturnType<typeof setTimeout> }>()
  /** The last title actually committed per tab — see the `settled` check below. */
  const settled = new Map<number, string>()

  const cancel = (tabId: number) => {
    const p = pending.get(tabId)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(tabId)
  }

  return {
    propose(tabId, rawTitle) {
      const title = cleanTitle(rawTitle)
      // Not a label at all (an exe path, a bare "claude", a spinner with no
      // text yet). Rejected without touching the candidate on the clock: a
      // frame the strip would never have shown must not disturb one it might.
      if (title === null) return

      // Already this tab's label. Cancels any candidate still ticking, which is
      // what makes the interruption case work: the summary coming back IS the
      // evidence that the command title was transient, and waiting out the rest
      // of that command's dwell would be waiting for something already over.
      if (settled.get(tabId) === title) {
        cancel(tabId)
        return
      }

      // The same candidate re-reported. Left strictly alone — claude re-emits
      // its title several times a second behind an animated spinner glyph, and
      // since cleanTitle strips the glyph those frames arrive here identical.
      // Restarting the clock for each one would mean no title ever settles.
      if (pending.get(tabId)?.title === title) return

      cancel(tabId)
      const timer = setTimeout(() => {
        pending.delete(tabId)
        settled.set(tabId, title)
        commit(tabId, title)
      }, DWELL_MS)
      pending.set(tabId, { title, timer })
    },

    forget(tabId) {
      cancel(tabId)
      settled.delete(tabId)
    },

    dispose() {
      for (const p of pending.values()) clearTimeout(p.timer)
      pending.clear()
      settled.clear()
    },
  }
}
