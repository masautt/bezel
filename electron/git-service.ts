import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitInfo } from '@shared/types.js'

const exec = promisify(execFile)

// One git process per reading, not two.
//
// This used to be simple-git's `checkIsRepo()` followed by `status()`. Measured
// against this repo that pair cost ~792ms per call, where a single
// `status --porcelain=v2 --branch` costs ~183ms — and `checkIsRepo` was pure
// overhead, since `status` already fails on a directory that is not a repo,
// which is the branch the null below exists for.
//
// `core.quotePath=false` stops git escaping non-ASCII paths into `"\303\251"`
// form, which would otherwise reach the Changes widget verbatim.
const ARGS = ['-c', 'core.quotePath=false', 'status', '--porcelain=v2', '--branch']

/** Generous: a repo with thousands of untracked files still has to fit. */
const MAX_BUFFER = 16 * 1024 * 1024

/**
 * Porcelain v2, as the widgets want it.
 *
 * The format is line-oriented and self-delimiting, which is why it is worth
 * parsing directly. Header lines start `# `, and the entry kinds are:
 *
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path><TAB><origPath>
 *   u <XY> …                                        (unmerged)
 *   ? <path>                                        (untracked)
 *   ! <path>                                        (ignored)
 *
 * `XY` is two status letters: X is what is staged, Y is what is in the working
 * tree, and `.` means unchanged in that half. The working-tree letter wins —
 * a file staged and then edited again is described by what is on disk now,
 * which is what the user is looking at.
 *
 * Exported for direct testing of the cases a temp repo makes awkward to build
 * (renames, unmerged entries); the behaviour is otherwise covered against real
 * repositories in tests/git-service.test.ts.
 */
export function parsePorcelainV2(stdout: string): GitInfo {
  let branch: string | null = null
  let ahead = 0
  const dirty: string[] = []

  for (const line of stdout.split('\n')) {
    if (line === '') continue

    if (line.startsWith('# ')) {
      // `# branch.head <name>`, or literally `(detached)` when there is no
      // branch to name — which is not a branch, so it is not reported as one.
      if (line.startsWith('# branch.head ')) {
        const name = line.slice('# branch.head '.length).trim()
        branch = name === '(detached)' ? null : name
      } else if (line.startsWith('# branch.ab ')) {
        // `+<ahead> -<behind>`. Absent entirely when the branch has no
        // upstream, which is why `ahead` starts at 0 rather than being parsed
        // into a null.
        const m = /^# branch\.ab \+(\d+) -(\d+)/.exec(line)
        if (m) ahead = Number(m[1])
      }
      continue
    }

    const kind = line[0]

    if (kind === '?' || kind === '!') {
      // Ignored entries are not requested (no --ignored), but a `!` would be
      // a file the user cannot act on, so it is skipped either way.
      if (kind === '?') dirty.push(`? ${line.slice(2)}`)
      continue
    }

    if (kind !== '1' && kind !== '2' && kind !== 'u') continue

    const xy = line.slice(2, 4)
    // The path is the last field, and may itself contain spaces — so the
    // leading fields are counted off rather than the line being split apart.
    // A rename (kind 2) carries one extra field before the path, and its path
    // is followed by a tab and the ORIGINAL path, which the widgets do not show.
    const leading = kind === '2' ? 9 : 8
    let at = 0
    for (let field = 0; field < leading; field++) {
      at = line.indexOf(' ', at)
      if (at === -1) break
      at++
    }
    if (at === -1 || at >= line.length) continue
    const path = line.slice(at).split('\t')[0]

    // Unmerged entries have no `.` half — both sides carry a real letter — so
    // the working-tree side is the right one to show there too.
    const staged = xy[0]
    const working = xy[1]
    const letter = working && working !== '.' ? working : staged
    dirty.push(`${letter} ${path}`)
  }

  return { branch, ahead, dirty }
}

// null, not an empty GitInfo: "we could not read this" and "this repo is clean"
// are different facts, and an empty GitInfo makes them identical. Collapsing them
// let ChangesWidget render "clean" — a positive claim — for a repo whose status
// call had just failed.
//
// The catch is also the not-a-repo branch: `git status` exits non-zero outside a
// work tree, and `execFile` rejects when the cwd does not exist at all.
export async function gitInfo(root: string): Promise<GitInfo | null> {
  try {
    const { stdout } = await exec('git', ARGS, {
      cwd: root,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    })
    return parsePorcelainV2(stdout)
  } catch {
    return null
  }
}
