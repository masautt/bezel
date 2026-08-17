export type { PaneRole, PaneKey } from './tabs.js'

export interface ProjectContext {
  /** Always the live directory — never substituted, never stale. */
  cwd: string
  org: string | null
  repo: string | null
  root: string | null
  /** True when org/repo/root are remembered from an earlier resolution rather
   *  than derived from `cwd`. See applyStickyContext in src/paths.ts. */
  pinned: boolean
}

export interface GitInfo {
  branch: string | null
  ahead: number
  dirty: string[]
}

export interface AppEntry {
  org: string
  repo: string
  root: string
  group: string
  description: string
  /** True when the repo declares a manifest.json — i.e. it is a real app, not
   *  just a repo that happens to live under an org. Only ~30 of ~139 do. */
  hasManifest: boolean
  /** mtime of .git/HEAD in epoch ms, 0 if unreadable. Proxy for last activity:
   *  it moves on commit, checkout, fetch, and branch switch. */
  lastActivity: number
}

/**
 * Which lens `buildAppsView` groups by. The Context widget's repo switcher is
 * fixed to 'recent'; the other two remain because the grouping helpers are
 * shared and independently tested.
 */
export type AppsView = 'apps' | 'orgs' | 'recent'

/** Which of the two documents this is, per the devkit `-design.md` / `-plan.md`
 *  filename convention. `null` for anything that follows neither. */
export type SpecKind = 'design' | 'plan'

export interface SpecItem {
  filename: string
  title: string
  /** The filename's kind suffix, lifted out of `title` so the widget can show it
   *  as a glyph instead of repeating the word. */
  kind: SpecKind | null
  status: string
  tldr: string[]
  htmlPath: string
}
