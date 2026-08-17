import { describe, it, expect, vi } from 'vitest'
import { createPtyManager, type SpawnFn } from '../electron/pty-manager'

function fakePty() {
  const handlers: { data?: (d: string) => void; exit?: (e: { exitCode: number }) => void } = {}
  return {
    handlers,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (d: string) => void) => { handlers.data = cb },
    onExit: (cb: (e: { exitCode: number }) => void) => { handlers.exit = cb },
  }
}

describe('createPtyManager', () => {
  it('spawns claude with an inlined csource under -NoProfile, shell with the prompt hook', () => {
    const ptys = [fakePty(), fakePty()]
    let i = 0
    // Typed to match SpawnFn's (file, args, opts) signature so
    // spawnFn.mock.calls[n] below is a real 3-tuple, not an inferred [].
    const spawnFn = vi.fn<SpawnFn>((_file, _args, _opts) => ptys[i++])
    const mgr = createPtyManager(spawnFn)

    mgr.spawn('1:claude', 'C:/Users/testuser/source', { mode: 'new' })
    mgr.spawn('1:shell', 'C:/Users/testuser/source', { mode: 'new' })

    // -NoProfile is the point of the inlining: the profile costs ~1.6s and the
    // claude pane does not need it to start. Asserted explicitly so a revert to
    // calling `csource` (a profile function) cannot pass this test.
    expect(spawnFn.mock.calls[0][1].slice(0, 4)).toEqual(['-NoLogo', '-NoExit', '-NoProfile', '-Command'])
    expect(spawnFn.mock.calls[0][1][4]).toContain('claude --dangerously-skip-permissions')
    // The profile still loads, but only after claude exits — that trailing
    // prompt is one the user goes on typing at.
    expect(spawnFn.mock.calls[0][1][4]).toContain('. $PROFILE')
    expect(spawnFn.mock.calls[1][1].slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command'])
    expect(spawnFn.mock.calls[1][1][3]).toContain(']7;file:///')
    expect(spawnFn.mock.calls[0][2].cwd).toBe('C:/Users/testuser/source')
  })

  it('retries claude on CommandNotFoundException so a mid-update pane recovers', () => {
    const pty = fakePty()
    const spawnFn = vi.fn<SpawnFn>((_file, _args, _opts) => pty)
    const mgr = createPtyManager(spawnFn)

    mgr.spawn('1:claude', 'C:/Users/testuser/source', { mode: 'new' })
    const cmd = spawnFn.mock.calls[0][1][4]

    // claude-code's auto-updater deletes claude.exe for ~10s while leaving the
    // claude.ps1 shim on PATH. Catching by TYPE is load-bearing: a bare `catch`
    // would also swallow real in-session failures and spin for 30s on them.
    expect(cmd).toContain('catch [System.Management.Automation.CommandNotFoundException]')
    // The retry must wrap the invocation itself. A Get-Command/Test-Path preflight
    // cannot work here — the shim still resolves while its target is gone.
    expect(cmd).not.toMatch(/Get-Command\s+claude/)
    expect(cmd).toContain('Start-Sleep -Milliseconds 500')
    // Bounded: 60 * 500ms. An unbounded loop would hang the pane forever when
    // claude is genuinely uninstalled rather than merely updating.
    expect(cmd).toContain('$n -ge 60')
  })

  it('routes data events with the originating pane id', () => {
    const pty = fakePty()
    const mgr = createPtyManager((() => pty) as never)
    const seen: Array<[string, string]> = []
    mgr.onData((id, d) => seen.push([id, d]))

    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    pty.handlers.data!('hello')

    expect(seen).toEqual([['1:shell', 'hello']])
  })

  it('forwards write and resize to the right pty', () => {
    const claude = fakePty()
    const shell = fakePty()
    const order = [claude, shell]
    let i = 0
    const mgr = createPtyManager((() => order[i++]) as never)

    mgr.spawn('1:claude', 'C:/tmp', { mode: 'new' })
    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.write('1:shell', 'ls\r')
    mgr.resize('1:claude', 120, 40)

    expect(shell.write).toHaveBeenCalledWith('ls\r')
    expect(claude.write).not.toHaveBeenCalled()
    expect(claude.resize).toHaveBeenCalledWith(120, 40)
  })

  it('is a no-op when writing to a pane that was never spawned', () => {
    const mgr = createPtyManager((() => fakePty()) as never)
    expect(() => mgr.write('1:shell', 'x')).not.toThrow()
  })

  it('kills a running pane and forgets it', () => {
    const pty = fakePty()
    const mgr = createPtyManager((() => pty) as never)
    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.kill('1:shell')
    expect(pty.kill).toHaveBeenCalled()
    mgr.write('1:shell', 'x')
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('kills the existing pty for a pane before replacing it on respawn', () => {
    const first = fakePty()
    const second = fakePty()
    const order = [first, second]
    let i = 0
    const mgr = createPtyManager((() => order[i++]) as never)

    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })

    expect(first.kill).toHaveBeenCalled()
    mgr.write('1:shell', 'x')
    expect(second.write).toHaveBeenCalledWith('x')
    expect(first.write).not.toHaveBeenCalled()
  })

  it('ignores a stale exit event from a pty that was already replaced', () => {
    const first = fakePty()
    const second = fakePty()
    const order = [first, second]
    let i = 0
    const mgr = createPtyManager((() => order[i++]) as never)
    const seen: Array<[string, number]> = []
    mgr.onExit((id, code) => seen.push([id, code]))

    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' }) // registers `second`; kills `first` (async exit pending)

    // `first`'s exit arrives after `second` is already registered — this must
    // be a no-op, not a delete of the live entry.
    first.handlers.exit!({ exitCode: 0 })

    expect(seen).toEqual([])
    mgr.write('1:shell', 'x')
    expect(second.write).toHaveBeenCalledWith('x')

    // A real exit of the CURRENT pty still fires and still cleans up.
    second.handlers.exit!({ exitCode: 1 })
    expect(seen).toEqual([['1:shell', 1]])
    mgr.write('1:shell', 'y')
    expect(second.write).toHaveBeenCalledTimes(1) // not called again after exit
  })

  it('picks spawn args by the role in the key, for any tab', () => {
    const ptys = [fakePty(), fakePty()]
    let i = 0
    const spawnFn = vi.fn<SpawnFn>((_file, _args, _opts) => ptys[i++])
    const mgr = createPtyManager(spawnFn)

    mgr.spawn('4:claude', 'C:/tmp', { mode: 'new' })
    mgr.spawn('4:shell', 'C:/tmp', { mode: 'new' })

    expect(spawnFn.mock.calls[0][1]).toContain('-NoProfile')
    expect(spawnFn.mock.calls[1][1]).not.toContain('-NoProfile')
    expect(spawnFn.mock.calls[1][1][3]).toContain(']7;file:///')
  })

  it('keeps tabs isolated', () => {
    const one = fakePty()
    const two = fakePty()
    const order = [one, two]
    let i = 0
    const mgr = createPtyManager((() => order[i++]) as never)

    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.spawn('2:shell', 'C:/tmp', { mode: 'new' })
    mgr.write('2:shell', 'ls\r')
    mgr.resize('1:shell', 120, 40)

    expect(two.write).toHaveBeenCalledWith('ls\r')
    expect(one.write).not.toHaveBeenCalled()
    expect(one.resize).toHaveBeenCalledWith(120, 40)
    expect(two.resize).not.toHaveBeenCalled()
    // Spawning tab 2 must NOT have killed tab 1's pty.
    expect(one.kill).not.toHaveBeenCalled()
  })

  it('kills only the requested key', () => {
    const one = fakePty()
    const two = fakePty()
    const order = [one, two]
    let i = 0
    const mgr = createPtyManager((() => order[i++]) as never)

    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.spawn('2:shell', 'C:/tmp', { mode: 'new' })
    mgr.kill('1:shell')

    expect(one.kill).toHaveBeenCalled()
    expect(two.kill).not.toHaveBeenCalled()
    mgr.write('2:shell', 'x')
    expect(two.write).toHaveBeenCalledWith('x')
  })

  it('killAll kills every live pty and forgets them', () => {
    const ptys = [fakePty(), fakePty(), fakePty()]
    let i = 0
    const mgr = createPtyManager((() => ptys[i++]) as never)

    mgr.spawn('1:claude', 'C:/tmp', { mode: 'new' })
    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.spawn('2:claude', 'C:/tmp', { mode: 'new' })
    mgr.killAll()

    expect(ptys.every(p => p.kill.mock.calls.length === 1)).toBe(true)
    mgr.write('2:claude', 'x')
    expect(ptys[2].write).not.toHaveBeenCalled()
  })

  // The spare pool. Its whole reason for existing is that claude's boot is
  // dominated by remote MCP connector handshakes — measured at 40-60s, and paid
  // per tab — which nothing bezel does to the shell path can touch. Prewarming
  // moves that cost off the moment the user opens a tab; every test below is
  // about the pool staying INVISIBLE while it does so.
  describe('prewarm', () => {
    const WARM = 'C:/Users/testuser/source'

    /** Spawns fresh fakePtys and records them in order. */
    function tracker() {
      const made: ReturnType<typeof fakePty>[] = []
      const spawnFn = vi.fn<SpawnFn>((_file, _args, _opts) => {
        const p = fakePty()
        made.push(p)
        return p
      })
      return { made, spawnFn }
    }

    it('spawns one idle spare per role, after the requested delay', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)

        mgr.prewarm(WARM, 8000)
        // Deferred on purpose: spares must not race the window's own panes.
        expect(spawnFn).not.toHaveBeenCalled()
        vi.advanceTimersByTime(8000)

        // One pty per tick, never a batch: nodePty.spawn blocks the main thread.
        expect(made).toHaveLength(1)
        expect(spawnFn.mock.calls[0][1]).toContain('-NoProfile') // claude first
        expect(spawnFn.mock.calls[0][2].cwd).toBe(WARM)

        // Its shell follows close behind — a spare tab is only useful complete.
        vi.advanceTimersByTime(2000)
        expect(made).toHaveLength(2)
        expect(spawnFn.mock.calls[1][1]).not.toContain('-NoProfile') // shell
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps filling to three tabs\' worth, a round at a time', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)

        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(2000)
        // The first tab-worth is the one that matters; the two behind it are
        // insurance, and buying them is not allowed to cost the user anything.
        expect(made).toHaveLength(2)
        vi.advanceTimersByTime(59_000)
        expect(made).toHaveLength(2)

        vi.advanceTimersByTime(3000) // round 2 opens at +60s, its shell at +62s
        expect(made).toHaveLength(4)
        vi.advanceTimersByTime(62_000)
        expect(made).toHaveLength(6)

        // Full. Nothing further, ever — an unbounded pool would spawn claudes
        // for as long as the app stayed open.
        vi.advanceTimersByTime(600_000)
        expect(made).toHaveLength(6)
      } finally {
        vi.useRealTimers()
      }
    })

    it('hands out three tabs in a row without a single cold spawn', () => {
      vi.useFakeTimers()
      try {
        const { spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(200_000) // pool full

        spawnFn.mockClear()
        for (const tab of [2, 3, 4]) {
          mgr.spawn(`${tab}:claude`, WARM, { mode: 'new' })
          mgr.spawn(`${tab}:shell`, WARM, { mode: 'new' })
        }
        // The whole point of the depth: a burst of new tabs is instant, not just
        // the first one.
        expect(spawnFn).not.toHaveBeenCalled()

        // And the fourth falls back to a cold spawn rather than failing.
        mgr.spawn('5:claude', WARM, { mode: 'new' })
        expect(spawnFn).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('skips past a stale spare to a good one behind it', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(200_000)

        const oldestClaude = made[0]
        oldestClaude.handlers.exit!({ exitCode: 1 })

        spawnFn.mockClear()
        mgr.spawn('2:claude', WARM, { mode: 'new' })

        // Giving up at the first corpse would waste the two live claudes behind
        // it and cold-spawn instead.
        expect(spawnFn).not.toHaveBeenCalled()
        mgr.write('2:claude', 'hi')
        expect(oldestClaude.write).not.toHaveBeenCalled()
        expect(made[2].write).toHaveBeenCalledWith('hi') // made[2] = claude #2
      } finally {
        vi.useRealTimers()
      }
    })

    // This used to rebuild the WHOLE pool. It now rebuilds half of it: see the
    // note on isFit for why a claude spare outlives a theme change and a shell
    // spare does not. The fill alternates claude, shell, claude, … so the two
    // roles land on even and odd indices respectively.
    it('rebuilds only the shell half of the pool after a theme change', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        let theme = 'dark'
        const mgr = createPtyManager(spawnFn, 'pwsh.exe', undefined, {
          file: 'C:/u/pane-theme',
          read: () => theme,
        })
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(200_000)
        const stale = made.slice()
        const staleClaude = stale.filter((_, i) => i % 2 === 0)
        const staleShell = stale.filter((_, i) => i % 2 === 1)

        theme = 'light'
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(200_000)

        // The expensive half survives: nothing in a claude pane reads
        // BEZEL_THEME until claude exits.
        expect(staleClaude.every(p => p.kill.mock.calls.length === 0)).toBe(true)
        // The visible half does not: its first prompt would be the old colour.
        expect(staleShell.every(p => p.kill.mock.calls.length === 1)).toBe(true)
        // Three shells rebuilt, three claudes kept — nine spawned in total
        // rather than the twelve a full rebuild cost.
        expect(made).toHaveLength(9)
        expect(spawnFn.mock.calls.at(-1)![2].env.BEZEL_THEME).toBe('light')
      } finally {
        vi.useRealTimers()
      }
    })

    // The premise the exemption below rests on, pinned so it cannot rot: the
    // claude pane is spawned with -NoProfile and no prompt hook, so nothing in
    // it ever consults the theme FILE. Its BEZEL_THEME is read once, by
    // oh-my-posh, for the prompt that appears only after claude exits. The
    // shell pane is the opposite: its hook re-reads the file on every prompt,
    // which is what lets a live shell follow a theme change.
    it('gives only the shell pane a live theme lookup', () => {
      const { spawnFn } = tracker()
      const mgr = createPtyManager(spawnFn, 'pwsh.exe', undefined, {
        file: 'C:/u/pane-theme',
        read: () => 'dark',
      })

      mgr.spawn('1:claude', WARM, { mode: 'new' })
      mgr.spawn('1:shell', WARM, { mode: 'new' })

      const claudeCmd = (spawnFn.mock.calls[0][1] as string[]).join(' ')
      const shellCmd = (spawnFn.mock.calls[1][1] as string[]).join(' ')
      expect(claudeCmd).not.toContain('C:/u/pane-theme')
      expect(shellCmd).toContain('C:/u/pane-theme')
    })

    // A booted claude spare is the most expensive thing this pool holds: its
    // startup is dominated by remote MCP connector handshakes, measured at tens
    // of seconds. Throwing three of them away re-colours a prompt the user
    // cannot see until they quit claude in that pane — and buys, in exchange,
    // the next few new tabs opening cold.
    it('keeps a booted claude spare through a theme change', () => {
      vi.useFakeTimers()
      try {
        const { spawnFn } = tracker()
        let theme = 'dark'
        const mgr = createPtyManager(spawnFn, 'pwsh.exe', undefined, {
          file: 'C:/u/pane-theme',
          read: () => theme,
        })
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(200_000)

        theme = 'light'
        spawnFn.mockClear()
        mgr.spawn('2:claude', WARM, { mode: 'new' })

        expect(spawnFn, 'the spare should have been adopted, not rebuilt').not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    // The other half of the same rule, and the reason it is a rule rather than
    // a blanket exemption: the shell pane shows a themed prompt immediately, so
    // a stale one is visible the moment the tab opens.
    it('still refuses a shell spare baked against an old theme', () => {
      vi.useFakeTimers()
      try {
        const { spawnFn } = tracker()
        let theme = 'dark'
        const mgr = createPtyManager(spawnFn, 'pwsh.exe', undefined, {
          file: 'C:/u/pane-theme',
          read: () => theme,
        })
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(200_000)

        theme = 'light'
        spawnFn.mockClear()
        mgr.spawn('2:shell', WARM, { mode: 'new' })

        expect(spawnFn).toHaveBeenCalledTimes(1)
        expect(spawnFn.mock.calls[0][2].env.BEZEL_THEME).toBe('light')
      } finally {
        vi.useRealTimers()
      }
    })

    it('says nothing to the renderer until a pane adopts it', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        const seen: Array<[string, string]> = []
        const exits: string[] = []
        mgr.onData((id, d) => seen.push([id, d]))
        mgr.onExit(id => exits.push(id))

        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(2000) // claude, then its shell
        made[0].handlers.data!('claude booting')

        // No pane owns this pty yet. Fanning it out would address it to a key
        // that does not exist, and in the exit case would tell a tab that has
        // never been opened that its process died.
        expect(seen).toEqual([])
        made[1].handlers.exit!({ exitCode: 1 })
        expect(exits).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })

    it('a new tab adopts the spare and replays what it missed', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        const seen: Array<[string, string]> = []
        mgr.onData((id, d) => seen.push([id, d]))

        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(0)
        const spare = made[0]
        spare.handlers.data!('welcome')
        spare.handlers.data!(' to claude')

        spawnFn.mockClear()
        mgr.spawn('2:claude', WARM, { mode: 'new' })

        // Adoption, not a spawn — that is the entire saving.
        expect(spawnFn).not.toHaveBeenCalled()
        expect(spare.kill).not.toHaveBeenCalled()
        // Everything it said while unowned, now addressed to the pane.
        expect(seen).toEqual([['2:claude', 'welcome'], ['2:claude', ' to claude']])
        // And it is wired up for real from here on.
        mgr.write('2:claude', 'hi')
        expect(spare.write).toHaveBeenCalledWith('hi')
        spare.handlers.data!('later')
        expect(seen.at(-1)).toEqual(['2:claude', 'later'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('replaces the spare it just handed out', () => {
      vi.useFakeTimers()
      try {
        const { spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(0)

        spawnFn.mockClear()
        mgr.spawn('2:claude', WARM, { mode: 'new' })
        // Not instantly: the tab that just opened is the one being waited on.
        expect(spawnFn).not.toHaveBeenCalled()
        vi.advanceTimersByTime(5000)
        expect(spawnFn).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('refuses a spare sitting in the wrong directory', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(0)
        const spare = made[0]

        spawnFn.mockClear()
        // Open-here and the keystroke-revive path spawn at arbitrary cwds. The
        // claude pane would cd itself, but the shell pane would silently land
        // the user in the wrong repo — so the rule is the same for both.
        mgr.spawn('2:claude', 'C:/somewhere/else', { mode: 'new' })

        expect(spawnFn).toHaveBeenCalledTimes(1)
        expect(spawnFn.mock.calls[0][2].cwd).toBe('C:/somewhere/else')
        expect(spare.kill).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('refuses a spare that died while idle, and spawns a live one instead', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        const exits: string[] = []
        mgr.onExit(id => exits.push(id))
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(0)
        made[0].handlers.exit!({ exitCode: 1 })

        spawnFn.mockClear()
        mgr.spawn('2:claude', WARM, { mode: 'new' })

        // Adopting a corpse would open the tab straight onto "[process exited]".
        expect(spawnFn).toHaveBeenCalledTimes(1)
        expect(exits).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })

    // The theme-staleness rule is now role-dependent, so it is pinned per role
    // up in the prewarm block: "keeps a booted claude spare through a theme
    // change" and "still refuses a shell spare baked against an old theme".
    // A single role-blind assertion here would contradict both.

    it('killAll and discardWarm reap the spares and cancel a pending prewarm', () => {
      vi.useFakeTimers()
      try {
        const { made, spawnFn } = tracker()
        const mgr = createPtyManager(spawnFn)
        mgr.prewarm(WARM, 0)
        vi.advanceTimersByTime(0)
        mgr.killAll()
        expect(made.every(p => p.kill.mock.calls.length === 1)).toBe(true)

        // A prewarm still in its delay must not fire after quit.
        mgr.prewarm(WARM, 5000)
        mgr.discardWarm()
        spawnFn.mockClear()
        vi.advanceTimersByTime(10000)
        expect(spawnFn).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('does not spawn for an unparseable key', () => {
    const spawnFn = vi.fn<SpawnFn>((_file, _args, _opts) => fakePty())
    const mgr = createPtyManager(spawnFn)

    mgr.spawn('claude', 'C:/tmp', { mode: 'new' })
    mgr.spawn('1:bash', 'C:/tmp', { mode: 'new' })

    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('a stale exit from a killed tab does not evict a live entry', () => {
    const one = fakePty()
    const two = fakePty()
    const order = [one, two]
    let i = 0
    const mgr = createPtyManager((() => order[i++]) as never)
    const seen: Array<[string, number]> = []
    mgr.onExit((key, code) => seen.push([key, code]))

    mgr.spawn('1:shell', 'C:/tmp', { mode: 'new' })
    mgr.spawn('2:shell', 'C:/tmp', { mode: 'new' })
    mgr.kill('1:shell')
    one.handlers.exit!({ exitCode: 0 })   // arrives after kill() already forgot it

    expect(seen).toEqual([])
    mgr.write('2:shell', 'x')
    expect(two.write).toHaveBeenCalledWith('x')
  })
})
