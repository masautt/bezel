import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTitleSettler, DWELL_MS } from '../src/title-settler'

/** Records what actually reached the reducer, in order. */
function spy() {
  const commits: { id: number; title: string }[] = []
  return { commits, commit: (id: number, title: string) => { commits.push({ id, title }) } }
}

describe('createTitleSettler', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('commits a title that survives the dwell', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'Identify performance improvements for Bezel')
    expect(commits).toEqual([])
    vi.advanceTimersByTime(DWELL_MS)
    expect(commits).toEqual([{ id: 1, title: 'Identify performance improvements for Bezel' }])
  })

  it('never commits a title that is replaced before the dwell elapses', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'Identify performance improvements for Bezel')
    vi.advanceTimersByTime(DWELL_MS - 1)
    s.propose(1, 'npm test')
    vi.advanceTimersByTime(DWELL_MS)
    expect(commits).toEqual([{ id: 1, title: 'npm test' }])
  })

  // The whole point of the feature, replayed from a real recorded session: the
  // summary is interrupted by npm's command titles and comes straight back.
  // Only the summary is ever on the clock long enough to land.
  it('commits only the summary across a real summary/command trace', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    const SUMMARY = 'Identify performance improvements for Bezel'
    s.propose(1, SUMMARY)
    vi.advanceTimersByTime(DWELL_MS)
    for (const cmd of ['npm init', 'npm', 'npm exec tsc -p electron/tsconfig.json', 'npm run build', 'npm test']) {
      s.propose(1, cmd)
      vi.advanceTimersByTime(2000)
      s.propose(1, SUMMARY)
      vi.advanceTimersByTime(2000)
    }
    vi.advanceTimersByTime(DWELL_MS)
    expect(commits.map(c => c.title)).toEqual([SUMMARY])
  })

  // Claude re-reports its title several times a second behind an animated
  // spinner glyph. cleanTitle strips the glyph, so those frames arrive here as
  // an identical string — and if each one restarted the dwell, nothing would
  // EVER settle.
  it('does not restart the dwell when the same title re-fires', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    for (let elapsed = 0; elapsed < DWELL_MS; elapsed += 100) {
      s.propose(1, '✳ Fixing the tab strip')
      vi.advanceTimersByTime(100)
    }
    expect(commits).toEqual([{ id: 1, title: 'Fixing the tab strip' }])
  })

  it('commits a settled title once, not on every later re-fire', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'Fixing the tab strip')
    vi.advanceTimersByTime(DWELL_MS)
    s.propose(1, 'Fixing the tab strip')
    vi.advanceTimersByTime(DWELL_MS * 3)
    expect(commits).toHaveLength(1)
  })

  it('rejects what cleanTitle rejects, without disturbing the pending title', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'Fixing the tab strip')
    vi.advanceTimersByTime(DWELL_MS - 1)
    s.propose(1, 'C:\\Program Files\\nodejs\\node.exe')
    s.propose(1, 'Claude Code')
    vi.advanceTimersByTime(1)
    expect(commits).toEqual([{ id: 1, title: 'Fixing the tab strip' }])
  })

  it('settles each tab on its own clock', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'First tab task')
    vi.advanceTimersByTime(DWELL_MS - 1)
    s.propose(2, 'Second tab task')
    vi.advanceTimersByTime(1)
    expect(commits).toEqual([{ id: 1, title: 'First tab task' }])
    vi.advanceTimersByTime(DWELL_MS)
    expect(commits).toEqual([
      { id: 1, title: 'First tab task' },
      { id: 2, title: 'Second tab task' },
    ])
  })

  it('drops a closed tab\'s pending title', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'Fixing the tab strip')
    s.forget(1)
    vi.advanceTimersByTime(DWELL_MS * 2)
    expect(commits).toEqual([])
  })

  it('commits nothing after dispose', () => {
    const { commits, commit } = spy()
    const s = createTitleSettler(commit)
    s.propose(1, 'First tab task')
    s.propose(2, 'Second tab task')
    s.dispose()
    vi.advanceTimersByTime(DWELL_MS * 2)
    expect(commits).toEqual([])
  })
})
