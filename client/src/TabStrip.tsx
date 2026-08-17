import { useMemo } from 'react'
import { resolveProjectPath } from '@shared/paths'
import { tabLabel, type Tab } from '@shared/tabs'

export interface TabStripProps {
  tabs: Tab[]
  activeId: number
  /** Repo roots from the Apps scan; the renderer has no filesystem access. */
  repoRoots: string[]
  /** Tabs whose panes have actually been spawned — see the note on `booted`
   *  in App. Anything not in here is dormant: restored but never activated. */
  booted: ReadonlySet<number>
  /** Restored tabs whose cwd came back missing from project:exists. Always a
   *  subset of "not booted" — see the note on `missing` in App. */
  missing: ReadonlySet<number>
  onSelect: (id: number) => void
  /** First click arms, second closes — the strip only reports the click. */
  onCloseIntent: (id: number) => void
  onNew: () => void
}

/**
 * The tab bar, rendered into AppBar's `actions` slot so it sits right of the
 * brand and left of the window controls. Everything here must be `no-drag` in
 * styles.css: the app bar is one big drag region and @devkit-inc/react-ui only
 * exempts its own buttons.
 */
export function TabStrip({ tabs, activeId, repoRoots, booted, missing, onSelect, onCloseIntent, onNew }: TabStripProps) {
  // Inside the component, not at module scope — see the note in ContextProvider.
  const ORGS_ROOT = window.bezel.roots.orgsRoot
  const isRepo = useMemo(() => {
    const roots = new Set(repoRoots)
    return (dir: string) => roots.has(dir)
  }, [repoRoots])

  return (
    <div className="tabstrip">
      {tabs.map(tab => {
        const { org, repo } = resolveProjectPath(tab.cwd, ORGS_ROOT, isRepo)
        const label = tabLabel(tab, repo, org)
        // Dormant: restored but never activated, so its panes were never
        // spawned — the honest "not booted" state, not a failure.
        const dormant = !booted.has(tab.id)
        // Missing: restored, and its cwd is gone from disk. Deliberately NOT
        // the attention dot, which means the opposite — that a tab has news
        // for you. A missing tab is always dormant too (see the guard in
        // App's `activate`), but gets its own class so it reads as an error
        // rather than merely "not booted yet".
        const isMissing = missing.has(tab.id)
        return (
          <div
            key={tab.id}
            className={`tab${tab.id === activeId ? ' on' : ''}${tab.attention ? ' ready' : ''}${dormant ? ' tab-dormant' : ''}${isMissing ? ' tab-missing' : ''}`}
          >
            <button
              className="tab-label"
              // The visible text truncates with an ellipsis, so the full label
              // has to stay reachable somewhere. When the session is waiting,
              // say so here too: the pulse and the dot are both color and
              // motion, neither of which survives a tooltip or a screen reader.
              title={tab.attention ? `${label} — ready for you` : label}
              aria-label={tab.attention ? `${label} — ready for you` : undefined}
              aria-current={tab.id === activeId ? 'true' : undefined}
              onClick={() => onSelect(tab.id)}
            >
              {/* Inside the label button, not beside it: the dot is part of the
                  same target, so clicking the thing that caught your eye is
                  what switches to the tab. `aria-hidden` because the button's
                  aria-label above already carries the state in words. */}
              {tab.attention && <span className="tab-dot" aria-hidden="true" />}
              {label}
            </button>
            <button
              className={`tab-close${tab.closeArmed ? ' arming' : ''}`}
              title={tab.closeArmed ? `Click again to close ${label}` : `Close ${label}`}
              aria-label={tab.closeArmed ? `Click again to close ${label}` : `Close ${label}`}
              onClick={() => onCloseIntent(tab.id)}
            >
              {/* Armed shows a checkmark rather than words: it reads as
                  "confirm" without language, and — unlike "sure?" — it's
                  the same width as the resting ✕, so arming never squeezes
                  the tab's already-ellipsized label. Color alone still
                  can't carry the state change: the pointer is already on
                  the button after the first click, and `.tab-close:hover`
                  has already applied the accent color, so the solid fill
                  (below) is what makes this a state anyone can see.

                  Rendered on every tab, including a lone one: closing the
                  last tab quits the app (Windows-Terminal-style), so there is
                  no state where the ✕ would be unreachable. */}
              {tab.closeArmed ? '✓' : '✕'}
            </button>
          </div>
        )
      })}
      <button className="tab-new" title="New tab (Ctrl+Shift+T)" aria-label="New tab" onClick={onNew}>
        +
      </button>
    </div>
  )
}
