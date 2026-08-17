export interface ResolvedPath {
  org: string | null
  repo: string | null
  root: string | null
}

export type IsRepo = (dir: string) => boolean

const NONE: ResolvedPath = { org: null, repo: null, root: null }

// Pure decision for what cwd to restore on launch: the persisted `lastCwd`
// only wins if it still points at a real directory. Renamed/deleted repos
// are routine in a tool that exists to move across ~139 of them — without
// this check a stale path would wedge every subsequent launch at a
// nonexistent cwd, with no in-app recovery. `exists` is injected the same
// way `resolveProjectPath` injects `isRepo`, so this stays testable without
// touching the filesystem.
//
// `defaultRoot` is passed in rather than read from a module constant: it is
// `deriveRoots(homedir()).sourceRoot`, which this module cannot compute
// without `os` (it is bundled into the renderer too). See src/roots.ts.
export function resolveLastCwd(
  stored: string | undefined,
  exists: (p: string) => boolean,
  defaultRoot: string
): string {
  if (stored && exists(stored)) return stored
  return defaultRoot
}

/** Same guard as resolveLastCwd, for the remembered repo root. A pin at a path
 *  that no longer exists is worse than no pin: nothing inside the app can
 *  clear it, and every widget would read against an unreadable directory. */
export function resolveLastRepoRoot(stored: string | undefined, exists: (p: string) => boolean): string | null {
  return stored && exists(stored) ? stored : null
}

// Converts backslashes, drops a trailing slash, and upper-cases the drive
// letter. Everything else keeps its casing — org and repo names are displayed.
export function normalizePath(p: string): string {
  const forward = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return forward.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`)
}

// Repos live at orgs/<org>/<repo>, except `also_clone` orgs which nest one level
// deeper (orgs/<org>/<group>/<repo>). Walk down from the org and stop at the
// shallowest directory the caller recognizes as a repo.
export function resolveProjectPath(cwd: string, orgsRoot: string, isRepo: IsRepo): ResolvedPath {
  const path = normalizePath(cwd)
  const root = normalizePath(orgsRoot)
  if (path === root) return NONE
  if (!path.startsWith(root + '/')) return NONE

  const parts = path.slice(root.length + 1).split('/')
  const org = parts[0]
  if (parts.length === 1) return { org, repo: null, root: null }

  let candidate = `${root}/${org}`
  for (let i = 1; i < parts.length; i += 1) {
    candidate = `${candidate}/${parts[i]}`
    if (isRepo(candidate)) {
      return { org, repo: parts.slice(1, i + 1).join('/'), root: candidate }
    }
  }
  return { org, repo: null, root: null }
}

export interface StickyContext extends ResolvedPath {
  /** True when org/repo/root came from `remembered` rather than from the cwd. */
  pinned: boolean
}

/**
 * bezel launches at the source root, which is OUTSIDE orgs/ and therefore resolves
 * to nothing — leaving Context, Specs, and Changes all dark in the app's own
 * default state. This substitutes the last resolution that actually had a repo
 * root whenever the live one comes back completely empty.
 *
 * The pin engages ONLY on `org === null`. An org-only result (sitting in
 * orgs/<org> with no repo below it) is real information about where you are,
 * and a memory must never outrank it — even though it cannot light Specs or
 * Changes, which both need a root.
 *
 * `cwd` is deliberately not handled here. The live cwd is never stale and never
 * substituted; only the org/repo/root triple is ever remembered, which is what
 * lets the Context widget show both facts at once.
 */
export function applyStickyContext(
  resolved: ResolvedPath,
  remembered: ResolvedPath | null
): StickyContext {
  if (resolved.org !== null) return { ...resolved, pinned: false }
  if (remembered) return { ...remembered, pinned: true }
  return { ...NONE, pinned: false }
}

/**
 * `C:/Users/<name>/source/orgs/x` -> `~/source/orgs/x`. Display only — never feed
 * the result back into resolveProjectPath.
 *
 * `home` is a parameter rather than a module constant recovered by stripping
 * `/source` off a hardcoded default. This module is bundled into the renderer and
 * cannot reach `os`, so the one component that formats a path for display passes
 * `window.bezel.roots.home`.
 */
export function abbreviateHome(p: string, home: string): string {
  const path = normalizePath(p)
  const base = normalizePath(home)
  if (path === base) return '~'
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path
}
