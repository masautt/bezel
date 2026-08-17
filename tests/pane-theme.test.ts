import { describe, it, expect } from 'vitest'
import { normalizePaneTheme, psLiteral, DEFAULT_PANE_THEME } from '../electron/pane-theme'
import { createPtyManager, type SpawnFn } from '../electron/pty-manager'

describe('normalizePaneTheme', () => {
  it('passes the two real values through', () => {
    expect(normalizePaneTheme('light')).toBe('light')
    expect(normalizePaneTheme('dark')).toBe('dark')
  })

  it('collapses anything else to dark', () => {
    // Not tidiness: this value is written to a file that a live shell reads
    // into its environment. Whatever arrives over IPC leaves here as one of two
    // literals, so the channel cannot carry anything else.
    for (const junk of [undefined, null, '', 'LIGHT', 'solarized', 42, {}, ['light']]) {
      expect(normalizePaneTheme(junk)).toBe('dark')
    }
  })

  it('defaults to dark, which is also what an absent env var means', () => {
    // The oh-my-posh config's palette template falls through to `dark` when
    // BEZEL_THEME is unset — the normal state in Windows Terminal, which loads
    // the same config and must keep looking as it does today.
    expect(DEFAULT_PANE_THEME).toBe('dark')
  })
})

describe('psLiteral', () => {
  it('wraps in single quotes so PowerShell expands nothing inside', () => {
    // A double-quoted PowerShell string would expand `$` and backticks. Paths
    // under %LOCALAPPDATA% are a plausible place for a `$` to turn up.
    expect(psLiteral('C:/Users/x/AppData/bezel/pane-theme')).toBe("'C:/Users/x/AppData/bezel/pane-theme'")
    expect(psLiteral('C:/a$b/c`d')).toBe("'C:/a$b/c`d'")
  })

  it('escapes an embedded quote by doubling it', () => {
    // The one metacharacter left inside single quotes. Unescaped, a path
    // containing an apostrophe would close the string and run the remainder.
    expect(psLiteral("C:/it's/here")).toBe("'C:/it''s/here'")
  })
})

/** Captures the argv and env of each spawn. */
function recordingSpawn() {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = []
  const spawnFn: SpawnFn = (_file, args, opts) => {
    calls.push({ args, env: opts.env })
    return { write() {}, resize() {}, kill() {}, onData() {}, onExit() {} }
  }
  return { calls, spawnFn }
}

describe('pty-manager pane theme wiring', () => {
  const source = { file: 'C:/u/bezel/pane-theme', read: () => 'light' }

  it('puts BEZEL_THEME in the spawn environment of both panes', () => {
    // The claude pane gets no prompt hook, but it does show a prompt once
    // Claude Code exits — so the spawn env is the only thing theming it.
    const { calls, spawnFn } = recordingSpawn()
    const mgr = createPtyManager(spawnFn, 'pwsh.exe', undefined, source)
    mgr.spawn('1:shell', 'C:/x', { mode: 'new' })
    mgr.spawn('1:claude', 'C:/x', { mode: 'new' })
    expect(calls[0].env.BEZEL_THEME).toBe('light')
    expect(calls[1].env.BEZEL_THEME).toBe('light')
  })

  it('re-reads the theme on every spawn, not once at construction', () => {
    // A pane revived by a keystroke, or moved by "Open here", must come up on
    // the theme that is current now — not the one that was current at launch.
    let current = 'dark'
    const { calls, spawnFn } = recordingSpawn()
    const mgr = createPtyManager(spawnFn, 'pwsh.exe', undefined, { file: 'C:/f', read: () => current })
    mgr.spawn('1:shell', 'C:/x', { mode: 'new' })
    current = 'light'
    mgr.spawn('1:shell', 'C:/x', { mode: 'new' })
    expect(calls[0].env.BEZEL_THEME).toBe('dark')
    expect(calls[1].env.BEZEL_THEME).toBe('light')
  })

  it('sets $env:BEZEL_THEME inside the prompt, before the wrapped prompt runs', () => {
    // Ordering is the mechanism: `& $__cpOld` is what invokes oh-my-posh, and
    // oh-my-posh reads its palette template from the environment at that
    // moment. Setting the variable after would theme the NEXT prompt.
    const { calls, spawnFn } = recordingSpawn()
    createPtyManager(spawnFn, 'pwsh.exe', undefined, source).spawn('1:shell', 'C:/x', { mode: 'new' })
    const command = calls[0].args.at(-1)!
    expect(command).toContain('$env:BEZEL_THEME')
    expect(command.indexOf('$env:BEZEL_THEME')).toBeLessThan(command.indexOf('& $__cpOld'))
  })

  it('reads the theme file in a form that survives the file not existing', () => {
    // Get-Content -EA 0 on a missing path yields NO output, and [string] of an
    // empty pipeline is $null — so `([string](Get-Content …)).Trim()` throws on
    // every render until the renderer has written the file once, which is the
    // state of a fresh install. Concatenating onto '' is what makes it a
    // string either way. Asserted on the emitted command because the failure is
    // in another language, in another process, and shows up as a PowerShell
    // error above every prompt rather than as anything this suite would catch.
    const { calls, spawnFn } = recordingSpawn()
    createPtyManager(spawnFn, 'pwsh.exe', undefined, source).spawn('1:shell', 'C:/x', { mode: 'new' })
    const command = calls[0].args.at(-1)!
    expect(command).toContain('("" + (Get-Content $__bzTheme -Raw -EA 0)).Trim()')
    expect(command).not.toContain('[string](Get-Content')
  })

  it('quotes the theme file path as a PowerShell literal', () => {
    const { calls, spawnFn } = recordingSpawn()
    createPtyManager(spawnFn, 'pwsh.exe', undefined, source).spawn('1:shell', 'C:/x', { mode: 'new' })
    expect(calls[0].args.at(-1)).toContain("'C:/u/bezel/pane-theme'")
  })

  it('still emits the OSC 7 report alongside the theme read', () => {
    // The theme line is an addition to the prompt wrapper, not a replacement:
    // losing OSC 7 would silently stop the gutters following `cd`.
    const { calls, spawnFn } = recordingSpawn()
    createPtyManager(spawnFn, 'pwsh.exe', undefined, source).spawn('1:shell', 'C:/x', { mode: 'new' })
    expect(calls[0].args.at(-1)).toContain(']7;file:///')
  })

  it('omits the theme plumbing entirely when no source is given', () => {
    // Keeps the manager usable — and its existing tests honest — without the
    // electron-side file.
    const { calls, spawnFn } = recordingSpawn()
    createPtyManager(spawnFn).spawn('1:shell', 'C:/x', { mode: 'new' })
    const command = calls[0].args.at(-1)!
    expect(command).not.toContain('BEZEL_THEME')
    expect(command).toContain(']7;file:///')
    expect(calls[0].env.BEZEL_THEME).toBeUndefined()
  })
})
