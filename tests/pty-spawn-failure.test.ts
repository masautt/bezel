import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPtyManager, type SpawnFn } from '../electron/pty-manager'
import { createPtyBridge, type HostHandle } from '../electron/pty-bridge'
import type { HostInbound, HostOutbound } from '../electron/pty-protocol'

/**
 * The failure this file exists for.
 *
 * `nodePty.spawn` is a synchronous native call that THROWS — on a cwd that has
 * been deleted, on a shell that is not executable, on a permissions error. When
 * it ran in main that throw surfaced as a rejected `pty:spawn` invoke, which is
 * why `formatSpawnError` exists and why the pane renders `[failed to start: …]`.
 *
 * Moving the manager into the utility process orphaned that path: the throw now
 * happens in the host, where nothing catches it, so it kills the host outright.
 * The bridge then does exactly what it was built to do on a host death and
 * synthesizes an exit for EVERY live key — so one pane opened at a stale
 * directory takes down every terminal in every tab.
 *
 * The prewarm path is worse still: its spawn runs inside a `setTimeout`, so
 * there is no caller frame at all, and its cwd is up to 8s stale by the time the
 * timer fires.
 */

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

afterEach(() => { vi.useRealTimers() })

describe('a spawn that throws', () => {
  const WARM = 'C:/Users/testuser/source'

  it('does not escape the prewarm timer', () => {
    // An exception here has no caller: it unwinds straight through the timer
    // callback and terminates the host, killing every pane that was working
    // fine — to fail at building a spare nobody had asked for yet.
    vi.useFakeTimers()
    const spawnFn = vi.fn<SpawnFn>(() => { throw new Error('spawn pwsh.exe ENOENT') })
    const mgr = createPtyManager(spawnFn)

    mgr.prewarm(WARM, 0)
    expect(() => vi.advanceTimersByTime(0)).not.toThrow()
  })

  it('leaves the pool able to fill once spawning works again', () => {
    // A directory that vanished between the prewarm request and its timer is
    // transient. Failing one tick must not wedge the chain permanently.
    vi.useFakeTimers()
    let broken = true
    const made: ReturnType<typeof fakePty>[] = []
    const spawnFn = vi.fn<SpawnFn>(() => {
      if (broken) throw new Error('spawn pwsh.exe ENOENT')
      const p = fakePty()
      made.push(p)
      return p
    })
    const mgr = createPtyManager(spawnFn)

    mgr.prewarm(WARM, 0)
    vi.advanceTimersByTime(0)
    expect(made, 'the broken tick produced no spare').toHaveLength(0)

    broken = false
    mgr.prewarm(WARM, 0)
    vi.advanceTimersByTime(0)
    expect(made, 'the pool recovered on the next prewarm').toHaveLength(1)
  })

  it('still propagates out of an explicit spawn, so the host can report it', () => {
    // The adopted path keeps throwing on purpose: it has a key and therefore a
    // pane waiting on an answer. The host catches it and turns it into
    // `spawn-failed` for that key — see pty-host-handler.
    const spawnFn = vi.fn<SpawnFn>(() => { throw new Error('spawn pwsh.exe ENOENT') })
    const mgr = createPtyManager(spawnFn)

    expect(() => mgr.spawn('1:claude', WARM, { mode: 'new' })).toThrow('spawn pwsh.exe ENOENT')
  })
})

// ---------------------------------------------------------------------------

function fakeHost() {
  const sent: HostInbound[] = []
  const handlers: { message?: (message: HostOutbound) => void; exit?: (code: number) => void } = {}
  const host: HostHandle = {
    postMessage: (m: HostInbound) => { sent.push(m) },
    on: ((event: string, cb: never) => {
      if (event === 'message') handlers.message = cb
      else handlers.exit = cb
    }) as HostHandle['on'],
    kill: vi.fn(() => true),
  }
  return {
    host,
    sent,
    emit: (message: HostOutbound) => handlers.message?.(message),
    ready: () => handlers.message?.({ t: 'ready' }),
    die: () => handlers.exit?.(1),
  }
}

const OPTS = { shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/pane-theme' }

function readyBridge() {
  const h = fakeHost()
  const bridge = createPtyBridge(() => h.host, OPTS)
  h.ready()
  return { h, bridge }
}

describe('the bridge on a reported spawn failure', () => {
  it('rejects that pane\'s spawn with the reason the host gave', async () => {
    const { h, bridge } = readyBridge()
    const spawned = bridge.spawn('1:claude', 'C:/gone', { mode: 'new' })

    h.emit({ t: 'spawn-failed', key: '1:claude', message: 'spawn pwsh.exe ENOENT' })

    // The renderer already renders this through formatSpawnError, and hands the
    // pane to the same keystroke-restart path a normal exit uses.
    await expect(spawned).rejects.toThrow('spawn pwsh.exe ENOENT')
  })

  it('leaves every other pane alone', async () => {
    // The regression in one line: before this, a failed spawn arrived as a dead
    // host, and a dead host is reported to every live key at once.
    const { h, bridge } = readyBridge()
    const exits: Array<[string, number]> = []
    bridge.onExit((key, code) => { exits.push([key, code]) })

    const alive = bridge.spawn('1:shell', 'C:/src', { mode: 'new' })
    h.emit({ t: 'spawned', key: '1:shell' })
    await alive

    const doomed = bridge.spawn('2:claude', 'C:/gone', { mode: 'new' })
    h.emit({ t: 'spawn-failed', key: '2:claude', message: 'spawn pwsh.exe ENOENT' })
    await expect(doomed).rejects.toThrow()

    expect(exits, 'a failed spawn must not exit the panes that are working').toEqual([])
  })

  it('does not treat the failed pane as live', async () => {
    // A key left in `live` would be handed a synthesized exit later, on a host
    // death that has nothing to do with it — a pane reporting that it died
    // twice, having never started once.
    const { h, bridge } = readyBridge()
    const exits: Array<[string, number]> = []
    bridge.onExit((key, code) => { exits.push([key, code]) })

    const doomed = bridge.spawn('1:claude', 'C:/gone', { mode: 'new' })
    h.emit({ t: 'spawn-failed', key: '1:claude', message: 'nope' })
    await expect(doomed).rejects.toThrow()

    h.die()
    expect(exits).toEqual([])
  })
})
