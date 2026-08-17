import { readdir, readFile, stat, access } from 'fs/promises'
import { join } from 'path'
// A relative import, not the `@shared` alias: tsc does not rewrite path-mapped
// specifiers in its output, so a runtime (non-type-only) import through the
// alias would resolve to a nonexistent "@shared" package once compiled.
import { normalizePath } from '../src/paths.js'
import type { AppEntry } from '@shared/types.js'

/**
 * How many levels below `orgs/<org>/` a repo may sit before the walk gives up.
 *
 * This is `max_repo_depth` in `masautt-inc/config`'s `layout.json` (6 segments
 * counting the housing org and the repo) minus the org segment itself. That field
 * exists because of this scan: the walk was first bounded at two levels, read off
 * nesting_rule's prose, which described only the flat and also_clone modes and
 * omitted family-grouped and explicit placement. Two levels silently missed 30 of
 * the 230 repos on this box — every `<family>/comps/<repo>`,
 * `<family>/templates/<repo>` and `hero/<character>/<repo>`.
 *
 * Five, not the three that covers this machine today: the deepest shape the layout
 * permits is an also_clone owner carrying an explicit sub-path,
 * `orgs/sbcbsd-inc/ITDBSD/teamx/customers/<dept>/<repo>`. That org is not cloned
 * here — it is the county's, and lives on the work box — so three would look
 * correct on this machine and quietly miss every Team-X customer repo on that one.
 * Measured: 3, 4 and 5 all find the same 230 repos here in ~20ms, because descent
 * stops at a repo and only the handful of container directories are ever walked
 * deeper. The bound costs nothing, so it should match the contract rather than the
 * current clone set.
 *
 * Deliberately a copied constant, not a read of layout.json: bezel must not fail to
 * start because another repo is not cloned (the same reasoning as src/roots.ts).
 * The conformance test in that repo fails if the real maximum ever drifts from 6.
 */
const MAX_DEPTH = 5

// Walks orgs/<org>/**, collecting every directory that is a git repo.
// `manifest.json` supplies the group and description when present (sbrain-scripts
// maintains these); repos without one fall back to the org name.
//
// Asynchronous, and that is the whole of the change: the walk is identical, but
// it used to run as one uninterrupted block of synchronous fs calls on the main
// thread. Measured at 230 repos / 127ms on this machine — six times the "~20ms"
// claimed below, and paid on the thread that also carries every pty keystroke.
export async function scanApps(orgsRoot: string): Promise<AppEntry[]> {
  const root = normalizePath(orgsRoot)
  const orgs = await dirs(root)
  const found = await Promise.all(orgs.map(org => walk(`${root}/${org}`, org, [], 1)))
  return found.flat()
}

// Descent stops AT a repo, never into it: a repo's own subdirectories are its
// contents, not more apps, and vendored checkouts inside one would otherwise be
// listed as siblings of the thing that contains them.
//
// `Promise.all` over the entries rather than a sequential loop: the walk is
// almost entirely I/O wait, and the results keep their input order, so the list
// is identical to the one the synchronous version produced.
async function walk(dir: string, org: string, trail: string[], depth: number): Promise<AppEntry[]> {
  const names = await dirs(dir)
  const branches = await Promise.all(names.map(async name => {
    const path = `${dir}/${name}`
    const next = [...trail, name]
    if (await isRepoDir(path)) return [await toEntry(org, next.join('/'), path)]
    if (depth < MAX_DEPTH) return walk(path, org, next, depth + 1)
    return []
  }))
  return branches.flat()
}

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map(d => d.name)
  } catch { return [] }
}

async function isRepoDir(path: string): Promise<boolean> {
  try {
    await access(join(path, '.git'))
    return true
  } catch { return false }
}

async function toEntry(org: string, repo: string, root: string): Promise<AppEntry> {
  let group = ''
  let description = ''
  let hasManifest = false
  try {
    const raw = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf-8')) as { group?: string; description?: string }
    group = raw.group ?? ''
    description = raw.description ?? ''
    hasManifest = true
  } catch { /* no manifest, or malformed — fall back to the defaults above */ }
  return { org, repo, root, group: group || org, description, hasManifest, lastActivity: await lastActivityOf(root) }
}

// mtime of .git/HEAD, which moves on commit, checkout, fetch, and branch switch.
// Cheaper than shelling out to git for ~139 repos, and accurate enough to rank
// "what have I touched lately". Returns 0 when unreadable — worktrees keep a
// .git FILE rather than a directory, and statSync handles both.
async function lastActivityOf(root: string): Promise<number> {
  try {
    return (await stat(join(root, '.git', 'HEAD'))).mtimeMs
  } catch {
    try { return (await stat(join(root, '.git'))).mtimeMs } catch { return 0 }
  }
}
