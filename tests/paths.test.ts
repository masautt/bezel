import { describe, it, expect } from 'vitest'
import {
  resolveProjectPath, resolveLastCwd, resolveLastRepoRoot,
  applyStickyContext, abbreviateHome,
} from '@shared/paths'
import { deriveRoots } from '@shared/roots'

// Derived the same way the app derives it, from a home directory that is NOT
// this machine's — the point of the change these cover is that no path in the
// app is tied to one username.
const HOME = 'C:/Users/testuser'
const { sourceRoot: DEFAULT_ROOT, orgsRoot: ORGS } = deriveRoots(HOME)

// The only two directories this suite treats as git repos. Injected rather than
// probed so the tests never touch the real filesystem.
const REPOS = new Set([
  'C:/Users/testuser/source/orgs/devkit-inc/localhub',
  'C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-scripts',
])
const resolve = (cwd: string) => resolveProjectPath(cwd, ORGS, dir => REPOS.has(dir))

describe('resolveProjectPath', () => {
  it('resolves a repo directly under an org', () => {
    expect(resolve('C:/Users/testuser/source/orgs/devkit-inc/localhub')).toEqual({
      org: 'devkit-inc',
      repo: 'localhub',
      root: 'C:/Users/testuser/source/orgs/devkit-inc/localhub',
    })
  })

  it('resolves from a nested subdirectory of a repo', () => {
    expect(resolve('C:/Users/testuser/source/orgs/devkit-inc/localhub/client/src')).toEqual({
      org: 'devkit-inc',
      repo: 'localhub',
      root: 'C:/Users/testuser/source/orgs/devkit-inc/localhub',
    })
  })

  it('normalizes Windows backslashes', () => {
    expect(resolve('C:\\Users\\testuser\\source\\orgs\\devkit-inc\\localhub').repo).toBe('localhub')
  })

  it('normalizes a lower-case drive letter', () => {
    expect(resolve('c:/Users/testuser/source/orgs/devkit-inc/localhub').repo).toBe('localhub')
  })

  it('treats a nested also_clone group as org + nested repo', () => {
    expect(resolve('C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-scripts/src')).toEqual({
      org: 'sbrain-inc',
      repo: 'sbrain/sbrain-scripts',
      root: 'C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-scripts',
    })
  })

  it('returns nulls at the orgs root itself', () => {
    expect(resolve(ORGS)).toEqual({ org: null, repo: null, root: null })
  })

  it('returns org only when sitting in an org directory', () => {
    expect(resolve('C:/Users/testuser/source/orgs/devkit-inc')).toEqual({
      org: 'devkit-inc',
      repo: null,
      root: null,
    })
  })

  it('returns all nulls for a path outside the orgs root', () => {
    expect(resolve('C:/Windows/System32')).toEqual({ org: null, repo: null, root: null })
  })

  it('returns org only when no ancestor directory is a known repo', () => {
    expect(resolve('C:/Users/testuser/source/orgs/devkit-inc/not-a-repo/deep')).toEqual({
      org: 'devkit-inc',
      repo: null,
      root: null,
    })
  })
})

describe('resolveLastCwd', () => {
  const REPO = `${ORGS}/devkit-inc/localhub`

  it('restores the stored path when it still exists', () => {
    expect(resolveLastCwd(REPO, p => p === REPO, DEFAULT_ROOT)).toBe(REPO)
  })

  it('falls back to the default root when the stored path no longer exists', () => {
    expect(resolveLastCwd(REPO, () => false, DEFAULT_ROOT)).toBe(DEFAULT_ROOT)
  })

  it('falls back to the default root when there is no stored value at all', () => {
    expect(resolveLastCwd(undefined, () => true, DEFAULT_ROOT)).toBe(DEFAULT_ROOT)
  })

  it('falls back to the default root for an empty string', () => {
    expect(resolveLastCwd('', () => true, DEFAULT_ROOT)).toBe(DEFAULT_ROOT)
  })
})

describe('resolveLastRepoRoot', () => {
  const REPO = `${ORGS}/devkit-inc/localhub`

  it('returns the stored root when it still exists', () => {
    expect(resolveLastRepoRoot(REPO, p => p === REPO)).toBe(REPO)
  })

  it('returns null for a deleted or renamed repo', () => {
    // A pin at a dead path would light Specs and Changes against a directory
    // that cannot be read, with no in-app way to clear it.
    expect(resolveLastRepoRoot(REPO, () => false)).toBeNull()
  })

  it('returns null when nothing was stored', () => {
    expect(resolveLastRepoRoot(undefined, () => true)).toBeNull()
  })
})

describe('applyStickyContext', () => {
  const REPO = { org: 'devkit-inc', repo: 'bezel', root: 'C:/Users/testuser/source/orgs/devkit-inc/bezel' }
  const EMPTY = { org: null, repo: null, root: null }
  const ORG_ONLY = { org: 'sbrain-inc', repo: null, root: null }

  it('passes a full resolution through unpinned', () => {
    expect(applyStickyContext(REPO, null)).toEqual({ ...REPO, pinned: false })
  })

  it('substitutes the remembered repo when the resolution is empty', () => {
    expect(applyStickyContext(EMPTY, REPO)).toEqual({ ...REPO, pinned: true })
  })

  it('yields all-nulls when there is nothing to remember', () => {
    expect(applyStickyContext(EMPTY, null)).toEqual({ ...EMPTY, pinned: false })
  })

  it('lets a real org-only resolution replace the pin', () => {
    // Landing inside a real org is information. A memory must not outrank it,
    // even though this result cannot light Specs or Changes.
    expect(applyStickyContext(ORG_ONLY, REPO)).toEqual({ ...ORG_ONLY, pinned: false })
  })

  it('prefers the live resolution when both are present', () => {
    const other = { org: 'sbrain-inc', repo: 'sbrain-scripts', root: 'C:/x/sbrain-scripts' }
    expect(applyStickyContext(other, REPO)).toEqual({ ...other, pinned: false })
  })
})

describe('abbreviateHome', () => {
  it('collapses the source root', () => {
    expect(abbreviateHome(`${HOME}/source`, HOME)).toBe('~/source')
  })

  it('collapses a nested path under the profile', () => {
    expect(abbreviateHome(`${ORGS}/devkit-inc/bezel`, HOME)).toBe('~/source/orgs/devkit-inc/bezel')
  })

  it('collapses the profile directory itself', () => {
    expect(abbreviateHome(HOME, HOME)).toBe('~')
  })

  it('normalizes separators before matching', () => {
    expect(abbreviateHome('C:\\Users\\testuser\\source', HOME)).toBe('~/source')
  })

  it('leaves a path outside the profile alone', () => {
    expect(abbreviateHome('D:/work/thing', HOME)).toBe('D:/work/thing')
  })

  it('does not collapse a sibling directory with a shared prefix', () => {
    // "C:/Users/testuser2" starts with "C:/Users/testuser" as a string but is a
    // different profile — the trailing slash in the guard is what stops it.
    expect(abbreviateHome('C:/Users/testuser2/source', HOME)).toBe('C:/Users/testuser2/source')
  })
})
