import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { gitInfo } from '../electron/git-service'

// Every test in this file drives REAL git against a real repository on disk,
// which is the point of it — a status parser tested against canned strings
// tests the strings. The cost is that a single test can spawn a dozen git
// processes (the upstream one builds a repo, a bare remote, pushes, and commits
// again), and vitest's 5s default is measured while 66 other files are
// competing for the same disk. That timeout fired on the full suite and never
// in isolation, which is the signature of contention rather than a slow parser.
vi.setConfig({ testTimeout: 30_000 })

// A plain temp directory, never `git init`'d — the "not a repo" branch, which
// shares its result with every other unreadable case (permission errors, git not
// installed, a corrupted repo).
const notARepo = mkdtempSync(join(tmpdir(), 'bezel-git-service-test-'))

// A real repo, so "clean" and "dirty" are answers this suite can tell apart from
// "could not read" — which is the whole point of the null.
const realRepo = mkdtempSync(join(tmpdir(), 'bezel-git-service-repo-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd: realRepo, stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'test')

afterAll(() => {
  rmSync(notARepo, { recursive: true, force: true })
  rmSync(realRepo, { recursive: true, force: true })
})

describe('gitInfo', () => {
  // null rather than an empty GitInfo: an empty one is indistinguishable from a
  // clean repo, which is how ChangesWidget came to render "clean" — a positive
  // claim — for a repo whose status call had just failed.
  it('returns null for a directory that is not a git repo', async () => {
    expect(await gitInfo(notARepo)).toBeNull()
  })

  it('returns null rather than throwing for a path that does not exist', async () => {
    expect(await gitInfo(join(notARepo, 'nope', 'missing'))).toBeNull()
  })

  it('reports a real repo, and a clean one is NOT null', async () => {
    const info = await gitInfo(realRepo)
    expect(info).not.toBeNull()
    expect(info?.dirty).toEqual([])
  })

  it('lists dirty files', async () => {
    writeFileSync(join(realRepo, 'touched.txt'), 'hello')
    const info = await gitInfo(realRepo)
    expect(info?.dirty.some(d => d.includes('touched.txt'))).toBe(true)
  })
})

/**
 * The shape of what `gitInfo` reports, pinned against real repositories.
 *
 * These exist because the implementation underneath is being replaced — one
 * `git status --porcelain=v2 --branch` in place of simple-git's `checkIsRepo` +
 * `status`, which measured 183ms against 792ms per call. The suite above covers
 * "is it null", not what a non-null answer CONTAINS, so a rewrite could pass it
 * while quietly changing every status letter, the branch, or the ahead count.
 *
 * Every assertion here is on `GitInfo` — what ChangesWidget and ContextWidget
 * actually render — never on how it was obtained.
 */
describe('gitInfo reporting', () => {
  const repos: string[] = []

  /** A repo with one commit, and a helper to run git in it. */
  function freshRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'bezel-git-report-'))
    repos.push(dir)
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    writeFileSync(join(dir, 'seed.txt'), 'seed')
    run('add', '.')
    run('commit', '-qm', 'seed')
    return { dir, run }
  }

  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true })
  })

  it('reports the current branch', async () => {
    const { dir } = freshRepo()
    expect((await gitInfo(dir))?.branch).toBe('main')
  })

  it('reports a branch renamed after the fact', async () => {
    const { dir, run } = freshRepo()
    run('checkout', '-q', '-b', 'feature/thing')
    expect((await gitInfo(dir))?.branch).toBe('feature/thing')
  })

  it('marks an untracked file', async () => {
    const { dir } = freshRepo()
    writeFileSync(join(dir, 'new.txt'), 'x')
    expect((await gitInfo(dir))?.dirty).toContain('? new.txt')
  })

  it('marks a tracked file modified in the working tree', async () => {
    const { dir } = freshRepo()
    writeFileSync(join(dir, 'seed.txt'), 'changed')
    expect((await gitInfo(dir))?.dirty).toContain('M seed.txt')
  })

  it('marks a newly staged file', async () => {
    const { dir, run } = freshRepo()
    writeFileSync(join(dir, 'added.txt'), 'x')
    run('add', 'added.txt')
    expect((await gitInfo(dir))?.dirty).toContain('A added.txt')
  })

  it('marks a deleted file', async () => {
    const { dir, run } = freshRepo()
    run('rm', '-q', 'seed.txt')
    expect((await gitInfo(dir))?.dirty).toContain('D seed.txt')
  })

  // The working-tree letter wins over the index letter: a file staged and then
  // edited again is reported by what is on disk now, which is what the user is
  // looking at.
  it('prefers the working-tree letter over the staged one', async () => {
    const { dir, run } = freshRepo()
    writeFileSync(join(dir, 'both.txt'), 'one')
    run('add', 'both.txt')
    writeFileSync(join(dir, 'both.txt'), 'two')
    expect((await gitInfo(dir))?.dirty).toContain('M both.txt')
  })

  it('counts commits ahead of the upstream', async () => {
    const { dir, run } = freshRepo()
    const remote = mkdtempSync(join(tmpdir(), 'bezel-git-remote-'))
    repos.push(remote)
    execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'pipe' })
    run('remote', 'add', 'origin', remote)
    run('push', '-q', '-u', 'origin', 'main')

    expect((await gitInfo(dir))?.ahead).toBe(0)

    writeFileSync(join(dir, 'seed.txt'), 'more')
    run('commit', '-qam', 'second')

    const info = await gitInfo(dir)
    expect(info?.ahead).toBe(1)
    expect(info?.branch).toBe('main')
  })

  it('reports zero ahead when there is no upstream at all', async () => {
    const { dir } = freshRepo()
    expect((await gitInfo(dir))?.ahead).toBe(0)
  })

  it('is clean right after a commit', async () => {
    const { dir } = freshRepo()
    expect((await gitInfo(dir))?.dirty).toEqual([])
  })
})
