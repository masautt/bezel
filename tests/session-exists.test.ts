import { describe, it, expect } from 'vitest'
import { sessionTranscriptPaths } from '../src/context-meter.js'

// Where claude keeps a conversation: ~/.claude/projects/<slug>/<uuid>.jsonl,
// the slug being the launch directory with every non-alphanumeric character
// replaced by a dash. bezel's claude panes all Set-Location to CSOURCE_DIR (or
// ~/source), so in practice they share one project directory — but the pane's
// own cwd is checked too, and its ancestors, because a user may have launched
// claude higher up.
describe('sessionTranscriptPaths', () => {
  const HOME = 'C:/Users/testuser'
  const UUID = '81e84288-14d3-4527-b1c6-2ed739fe11b0'

  it('points at the claude root first, since that is where the panes launch', () => {
    const paths = sessionTranscriptPaths(HOME, 'C:/Users/testuser/source', UUID)
    expect(paths[0]).toBe(`${HOME}/.claude/projects/C--Users-testuser-source/${UUID}.jsonl`)
  })

  it('includes ancestors, so a session started a level up is still found', () => {
    const paths = sessionTranscriptPaths(HOME, 'C:/Users/testuser/source/orgs/devkit-inc/bezel', UUID)
    expect(paths).toContain(`${HOME}/.claude/projects/C--Users-testuser-source/${UUID}.jsonl`)
  })

  it('is separator-agnostic', () => {
    const back = sessionTranscriptPaths(HOME, 'C:\\Users\\testuser\\source', UUID)
    const fwd = sessionTranscriptPaths(HOME, 'C:/Users/testuser/source', UUID)
    expect(back).toEqual(fwd)
  })

  it('never returns a path without the uuid in it', () => {
    for (const p of sessionTranscriptPaths(HOME, 'C:/Users/testuser/source', UUID)) {
      expect(p.endsWith(`${UUID}.jsonl`)).toBe(true)
    }
  })
})
