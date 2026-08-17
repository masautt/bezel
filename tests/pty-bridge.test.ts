import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPtyBridge, type HostHandle } from '../electron/pty-bridge'
import type { HostInbound, HostOutbound } from '../electron/pty-protocol'

/**
 * A stand-in for the utility process. An Electron `utilityProcess` cannot be
 * started under vitest, which is exactly why the bridge takes its handle by
 * injection — the fault paths below (silent host, host death, quit timeout) are
 * the reason this module exists, and none of them are reachable otherwise.
 */
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
    kill: host.kill as ReturnType<typeof vi.fn>,
    /** Push a message from the host, as the real MessagePort would. */
    // Delivered DIRECTLY, matching Electron's parent-side signature.
    emit: (message: HostOutbound) => handlers.message?.(message),
    /** The real host's first act, once its listener is installed. */
    ready: () => handlers.message?.({ t: 'ready' }),
    die: () => handlers.exit?.(1),
    last: () => sent[sent.length - 1],
  }
}

/** A bridge whose host has already announced itself — the steady state. */
function readyBridge(opts: Partial<typeof OPTS> & { spawnTimeoutMs?: number } = {}) {
  const h = fakeHost()
  const bridge = createPtyBridge(() => h.host, { ...OPTS, ...opts })
  h.ready()
  return { h, bridge }
}

const OPTS = { shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/pane-theme' }

afterEach(() => { vi.useRealTimers() })

describe('createPtyBridge', () => {
  // The regression this test exists for: `utilityProcess.fork()` returns before
  // the child installs its message listener, and Electron DROPS anything posted
  // into that window instead of buffering it. Posting `init` eagerly produced a
  // host process that was alive, had no children, spawned nothing, and reported
  // no error anywhere — the only symptom was panes that never appeared.
  it('sends nothing until the host announces itself', () => {
    const h = fakeHost()
    const bridge = createPtyBridge(() => h.host, OPTS)
    bridge.prewarm('C:/src', 0)
    void bridge.spawn('1:claude', 'C:/src', { mode: 'new' })

    expect(h.sent, 'messages posted before the host was listening').toEqual([])

    h.ready()
    // Flushed in the order they were asked for, init first.
    expect(h.sent).toEqual([
      { t: 'init', shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/pane-theme' },
      { t: 'prewarm', cwd: 'C:/src', delayMs: 0 },
      { t: 'spawn', key: '1:claude', cwd: 'C:/src', session: { mode: 'new' } },
    ])
  })

  it('initialises the host before anything else', () => {
    const { h } = readyBridge()
    expect(h.sent[0]).toEqual({ t: 'init', shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/pane-theme' })
  })

  it('resolves spawn only on the ack for THAT key', async () => {
    const { h, bridge } = readyBridge()

    const claude = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    const shell = bridge.spawn('1:shell', 'C:/src', { mode: 'new' })
    let claudeDone = false
    void claude.then(() => { claudeDone = true })

    // Spawns overlap, so an ack has to be matched by key — acking the shell
    // must not resolve the claude pane, or the loading screen lifts on one pty.
    h.emit({ t: 'spawned', key: '1:shell' })
    await shell
    await Promise.resolve()
    expect(claudeDone).toBe(false)

    h.emit({ t: 'spawned', key: '1:claude' })
    await expect(claude).resolves.toBeNull()
  })

  it('resolves spawn with the session id the host ack carried', async () => {
    // The renderer asks for a session without knowing its id and must learn
    // the one it got — including a spare's, decided long before the tab that
    // adopted it existed. This is the only place that value crosses from the
    // host's message back into the promise TerminalPane awaits.
    const { h, bridge } = readyBridge()

    const p = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    h.emit({ t: 'spawned', key: '1:claude', sessionId: 'session-uuid-456' })

    await expect(p).resolves.toBe('session-uuid-456')
  })

  it('rejects a spawn the host never acknowledges', async () => {
    vi.useFakeTimers()
    const { h, bridge } = readyBridge({ spawnTimeoutMs: 1000 })

    const p = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    const assertion = expect(p).rejects.toThrow(/did not acknowledge/)
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
  })

  it('forwards data and exit to the callbacks, keyed', () => {
    const { h, bridge } = readyBridge()
    const data: Array<[string, string]> = []
    const exits: Array<[string, number]> = []
    bridge.onData((k, d) => data.push([k, d]))
    bridge.onExit((k, c) => exits.push([k, c]))

    h.emit({ t: 'data', key: '1:shell', data: 'hello' })
    h.emit({ t: 'exit', key: '1:shell', code: 3 })

    expect(data).toEqual([['1:shell', 'hello']])
    expect(exits).toEqual([['1:shell', 3]])
  })

  it('synthesizes an exit for every live pane when the host dies', async () => {
    const { h, bridge } = readyBridge()
    const exits: Array<[string, number]> = []
    bridge.onExit((k, c) => exits.push([k, c]))

    const p = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    h.emit({ t: 'spawned', key: '1:claude' })
    await p
    void bridge.spawn('1:shell', 'C:/src', { mode: 'new' }) // still in flight when the host dies
    h.emit({ t: 'spawned', key: '1:shell' })

    h.die()

    // Both panes are attached to nothing; without this they look alive and
    // swallow every keystroke instead of offering the restart prompt.
    expect(exits.map(e => e[0]).sort()).toEqual(['1:claude', '1:shell'])
  })

  it('fails an in-flight spawn when the host dies rather than hanging', async () => {
    const { h, bridge } = readyBridge()
    const p = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    h.die()
    await expect(p).rejects.toThrow(/host exited/)
  })

  it('re-forks a dead host, so the restart prompt is not a dead end', async () => {
    // The renderer offers `[press any key to restart]` after a pane exits, and
    // that keystroke lands here. If the bridge simply refused once the host had
    // died, the prompt would be a lie: every restart would report
    // `[failed to start: pty host is not running]` for the life of the window.
    let forks = 0
    const hosts: Array<ReturnType<typeof fakeHost>> = []
    const bridge = createPtyBridge(() => {
      forks += 1
      const h = fakeHost()
      hosts.push(h)
      return h.host
    }, OPTS)
    hosts[0].ready()
    expect(forks).toBe(1)

    hosts[0].die()

    const p = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    expect(forks, 'a dead host was not replaced').toBe(2)

    // The replacement is initialised from scratch before anything else reaches it.
    hosts[1].ready()
    expect(hosts[1].sent[0].t).toBe('init')
    expect(hosts[1].sent).toContainEqual({ t: 'spawn', key: '1:claude', cwd: 'C:/src', session: { mode: 'new' } })

    hosts[1].emit({ t: 'spawned', key: '1:claude' })
    await expect(p).resolves.toBeNull()
  })

  it('clears pending acks on killAll, so a reload cannot resolve into a dead renderer', async () => {
    const { h, bridge } = readyBridge()
    const p = bridge.spawn('1:claude', 'C:/src', { mode: 'new' })
    bridge.killAll() // what did-start-navigation triggers
    await expect(p).rejects.toThrow(/killed before/)
    expect(h.last()).toEqual({ t: 'kill-all' })
  })

  it('shuts down on the ack', async () => {
    const { h, bridge } = readyBridge()
    const done = bridge.shutdown(500)
    expect(h.last()).toEqual({ t: 'kill-all' })
    h.emit({ t: 'killed-all' })
    await done
    expect(h.kill).toHaveBeenCalled()
  })

  it('shuts down anyway when the host never acks', async () => {
    vi.useFakeTimers()
    const { h, bridge } = readyBridge()
    const done = bridge.shutdown(500)
    await vi.advanceTimersByTimeAsync(501)
    await done
    // The timeout is the important half: a wedged host must not make bezel
    // unquittable. Killing it takes its pwsh/conpty grandchildren with it.
    expect(h.kill).toHaveBeenCalled()
  })

  it('forwards the rest of the interface verbatim', () => {
    const { h, bridge } = readyBridge()
    bridge.write('1:shell', 'ls\r')
    expect(h.last()).toEqual({ t: 'write', key: '1:shell', data: 'ls\r' })
    bridge.resize('1:shell', 120, 40)
    expect(h.last()).toEqual({ t: 'resize', key: '1:shell', cols: 120, rows: 40 })
    bridge.kill('1:shell')
    expect(h.last()).toEqual({ t: 'kill', key: '1:shell' })
    bridge.prewarm('C:/src', 0)
    expect(h.last()).toEqual({ t: 'prewarm', cwd: 'C:/src', delayMs: 0 })
    bridge.discardWarm()
    expect(h.last()).toEqual({ t: 'discard-warm' })
  })
})
