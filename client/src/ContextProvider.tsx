import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { resolveProjectPath, normalizePath, applyStickyContext } from '@shared/paths'
import type { ResolvedPath } from '@shared/paths'
import type { ProjectContext } from '@shared/types'

interface Value {
  context: ProjectContext
  setCwd(cwd: string): void
  /**
   * The active tab's own claude session, when bezel assigned one.
   *
   * Carried beside the cwd because the Window gauge needs to name a specific
   * conversation: every claude pane is rooted at the same directory, so a
   * cwd-only lookup returns whichever session on the machine wrote last —
   * which, with two tabs open, is routinely the other one's.
   */
  sessionId?: string
}

const Ctx = createContext<Value | null>(null)

export interface ContextProviderProps {
  /**
   * The active tab's authoritative cwd. Not just a seed: an effect re-syncs
   * internal state whenever this or `activeId` changes (e.g. on a tab switch,
   * or a background tab's OSC 7 update landing after it becomes active),
   * which is also what resets a "glance" made via `setCwd` back to the real
   * cwd.
   */
  cwd: string
  /** The active tab's claude session id, if it has one yet. */
  sessionId?: string
  /**
   * The active tab's id. `cwd` alone cannot signal every switch: `createTab`
   * always opens at `DEFAULT_ROOT`, so two fresh tabs share an identical cwd
   * string, and switching between them would otherwise produce no prop
   * change at all — leaving a pending glance pointed at the wrong tab. This
   * changes on every switch even when the cwd doesn't, which is what the
   * sync effect actually needs. Required — even callers that render a single,
   * non-switching provider (e.g. widget tests) must pass a constant, because a
   * default here would silently degenerate the sync effect's deps to `[cwd]`,
   * reviving the "glance survives a switch between two tabs sharing a cwd" bug.
   */
  activeId: number
  // Repo roots scanned in main. The renderer has no filesystem access, so this
  // list is what makes a directory recognizable as a repo.
  repoRoots: string[]
  children: ReactNode
}

export function ContextProvider({ cwd: authoritativeCwd, activeId, sessionId, repoRoots, children }: ContextProviderProps) {
  // Read here rather than at module scope: the preload supplies this, so a
  // module-level read would run at import time and couple this file to bridge
  // load order (and be unreachable for any test that imports it).
  const ORGS_ROOT = window.bezel.roots.orgsRoot
  const [cwd, setCwdState] = useState(() => normalizePath(authoritativeCwd))

  // The provider is NOT fully controlled: the repo switcher's `setCwd` lets the user
  // glance at another repo without moving the terminals, so internal state
  // deliberately diverges from `authoritativeCwd` until something authoritative
  // changes it. That "something" is this effect — it fires whenever the
  // active tab's real cwd changes OR the active tab itself changes (via
  // `activeId`), so a glance never survives a switch even between two tabs
  // that happen to share a cwd. It does NOT fire on every render (only when
  // one of the two deps actually changes), so it never clobbers a glance
  // made while staying on the same tab.
  useEffect(() => { setCwdState(normalizePath(authoritativeCwd)) }, [authoritativeCwd, activeId])

  const setCwd = useCallback((next: string) => setCwdState(normalizePath(next)), [])

  // The last resolution that actually had a repo root. bezel launches at
  // DEFAULT_ROOT, which is outside orgs/ and resolves to nothing — without this
  // the Context, Specs, and Changes widgets are all dark in the app's own
  // default state. See applyStickyContext.
  const [remembered, setRemembered] = useState<ResolvedPath | null>(null)

  // Seeded once, from the root main validated still exists on disk. A dead path
  // already came back as null, so this cannot pin to a directory that is gone.
  useEffect(() => {
    void window.bezel.project.last()
      .then(({ repoRoot }) => {
        if (!repoRoot) return
        const root = normalizePath(repoRoot)
        const resolved = resolveProjectPath(root, ORGS_ROOT, dir => dir === root)
        if (resolved.root) setRemembered(resolved)
      })
      // No pin — degrades to the pre-fix behavior, which is a working app.
      .catch(() => { /* ignore */ })
    // ORGS_ROOT comes from the preload and is constant for the process, so
    // listing it satisfies the exhaustive-deps rule without ever re-running this.
  }, [ORGS_ROOT])

  const value = useMemo<Value>(() => {
    const roots = new Set(repoRoots)
    const resolved = resolveProjectPath(cwd, ORGS_ROOT, dir => roots.has(dir))
    return { context: { cwd, ...applyStickyContext(resolved, remembered) }, setCwd, sessionId }
  }, [cwd, repoRoots, remembered, setCwd, ORGS_ROOT, sessionId])

  // Remembering happens HERE, not inside the useMemo above: a memo factory must
  // stay pure, and React may call it more than once per commit — which would
  // double the IPC write. Keyed on the resolved root, so a deeper cd inside the
  // same repo is a no-op.
  //
  // The `pinned` guard is load-bearing: without it a pinned render would
  // re-remember its own substituted value and fire an IPC call on every cwd
  // change outside orgs/, which is exactly the state this feature exists for.
  const { org, repo, root, pinned } = value.context
  const resolvedRoot = pinned ? null : root
  useEffect(() => {
    if (!resolvedRoot) return
    setRemembered({ org, repo, root: resolvedRoot })
    void window.bezel.project.rememberRepo(resolvedRoot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRoot])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProjectContext(): Value {
  const value = useContext(Ctx)
  if (!value) throw new Error('useProjectContext must be used inside <ContextProvider>')
  return value
}
