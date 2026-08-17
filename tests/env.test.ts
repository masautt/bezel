import { describe, it, expect } from 'vitest'
import { sanitizePaneEnv } from '@shared/env'

describe('sanitizePaneEnv', () => {
  it('strips every Claude Code session marker', () => {
    const out = sanitizePaneEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: 'C:/x/claude',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
      CLAUDE_EFFORT: 'high',
      CLAUDE_PID: '123',
      PATH: 'C:/Windows',
    })
    expect(Object.keys(out).filter(k => /^CLAUDE/.test(k))).toEqual([])
    expect(out.PATH).toBe('C:/Windows')
  })

  it('strips NoDefaultCurrentDirectoryInExePath, which breaks builds that shell out to relative scripts', () => {
    const out = sanitizePaneEnv({ NoDefaultCurrentDirectoryInExePath: '1', PATH: 'C:/Windows' })
    expect(out.NoDefaultCurrentDirectoryInExePath).toBeUndefined()
  })

  it('strips the color overrides that would drain a pane of all color', () => {
    const out = sanitizePaneEnv({ NO_COLOR: '1', FORCE_COLOR: '0', PATH: 'C:/Windows' })
    expect(out.NO_COLOR).toBeUndefined()
    expect(out.FORCE_COLOR).toBeUndefined()
    expect(out.PATH).toBe('C:/Windows')
  })

  it('strips color overrides regardless of case, since Windows env vars are case-insensitive', () => {
    const out = sanitizePaneEnv({ no_color: '1', Force_Color: '0' })
    expect(Object.keys(out).filter(k => /color/i.test(k))).toEqual([])
  })

  it('keeps variables that merely contain a color override name', () => {
    const out = sanitizePaneEnv({ NO_COLOR_SCHEME: 'keep-me', COLORTERM: 'truecolor' })
    expect(out.NO_COLOR_SCHEME).toBe('keep-me')
    expect(out.COLORTERM).toBe('truecolor')
  })

  it("strips a parent bezel's own BEZEL_THEME", () => {
    // Launching bezel from a bezel pane is the normal dev path, and it puts a
    // parent-chosen theme in process.env. pty-manager overwrites the key when it
    // has a PaneThemeSource, but nothing does when it does not.
    expect(sanitizePaneEnv({ BEZEL_THEME: 'light' }).BEZEL_THEME).toBeUndefined()
    expect(sanitizePaneEnv({ bezel_theme: 'light' }).bezel_theme).toBeUndefined()
  })

  it('always sets TERM so the pane reports a capable terminal', () => {
    expect(sanitizePaneEnv({}).TERM).toBe('xterm-256color')
    expect(sanitizePaneEnv({ TERM: 'dumb' }).TERM).toBe('xterm-256color')
  })

  it('passes unrelated variables through untouched', () => {
    const out = sanitizePaneEnv({ HOME: 'C:/Users/testuser', EDITOR: 'code', CLAUDIA: 'keep-me' })
    expect(out.HOME).toBe('C:/Users/testuser')
    expect(out.EDITOR).toBe('code')
    // CLAUDIA starts with "CLAUD" but is not a CLAUDE marker — the boundary matters.
    expect(out.CLAUDIA).toBe('keep-me')
  })

  it('does not mutate the source environment', () => {
    const source = { CLAUDE_PID: '1', PATH: 'C:/Windows' }
    sanitizePaneEnv(source)
    expect(source.CLAUDE_PID).toBe('1')
  })
})
