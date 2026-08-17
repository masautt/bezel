import { describe, it, expect, vi } from 'vitest'
import { createHostHandler } from '../electron/pty-host-handler'
import type { PtyManager } from '../electron/pty-manager'
import type { HostOutbound } from '../electron/pty-protocol'

/**
 * The host's message loop, lifted out of `pty-host.ts` so it can be tested at
 * all: that module touches `process.parentPort` at import time, which does not
 * exist under vitest — and the fault path below (a spawn that throws) is the
 * one thing in the host worth testing.
 */

function fakeManager(overrides: Partial<PtyManager> = {}) {
  const mgr: PtyManager = {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    prewarm: vi.fn(),
    discardWarm: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  }
  return mgr
}

function harness(mgr: PtyManager) {
  const posted: HostOutbound[] = []
  const handle = createHostHandler({
    post: m => { posted.push(m) },
    createManager: () => mgr,
  })
  handle({ t: 'init', shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/pane-theme' })
  return { handle, posted }
}

describe('createHostHandler', () => {
  it('acks a spawn that succeeded', () => {
    const mgr = fakeManager()
    const { handle, posted } = harness(mgr)

    handle({ t: 'spawn', key: '1:claude', cwd: 'C:/src', session: { mode: 'new' } })

    expect(mgr.spawn).toHaveBeenCalledWith('1:claude', 'C:/src', { mode: 'new' })
    expect(posted).toContainEqual({ t: 'spawned', key: '1:claude', sessionId: undefined })
  })

  it('carries the session id manager.spawn returned onto the ack', () => {
    // The only route by which a spare's uuid — decided long before the tab
    // that adopts it exists — reaches the renderer. Losing this wiring would
    // leave every OTHER assertion in this suite green, since none of them
    // pin a real id.
    const mgr = fakeManager({ spawn: vi.fn(() => 'session-uuid-123') })
    const { handle, posted } = harness(mgr)

    handle({ t: 'spawn', key: '1:claude', cwd: 'C:/src', session: { mode: 'new' } })

    expect(posted).toContainEqual({ t: 'spawned', key: '1:claude', sessionId: 'session-uuid-123' })
  })

  it('reports a spawn that threw instead of dying', () => {
    // Before this, the throw unwound out of the parentPort listener and took
    // the whole host with it — every pty in every tab, for one bad cwd.
    const mgr = fakeManager({
      spawn: vi.fn(() => { throw new Error('spawn pwsh.exe ENOENT') }),
    })
    const { handle, posted } = harness(mgr)

    expect(() => handle({ t: 'spawn', key: '1:claude', cwd: 'C:/gone', session: { mode: 'new' } })).not.toThrow()

    expect(posted).toContainEqual({
      t: 'spawn-failed',
      key: '1:claude',
      message: 'spawn pwsh.exe ENOENT',
    })
    expect(posted, 'a failure is not also an ack').not.toContainEqual({ t: 'spawned', key: '1:claude' })
  })

  it('keeps serving other panes after one spawn failed', () => {
    // The whole point of catching it: the host is still the owner of every
    // other pty, and those panes are fine.
    let broken = true
    const mgr = fakeManager({
      spawn: vi.fn(() => { if (broken) throw new Error('spawn pwsh.exe ENOENT'); return null }),
    })
    const { handle, posted } = harness(mgr)

    handle({ t: 'spawn', key: '1:claude', cwd: 'C:/gone', session: { mode: 'new' } })
    broken = false
    handle({ t: 'spawn', key: '1:shell', cwd: 'C:/src', session: { mode: 'new' } })

    expect(posted).toContainEqual({ t: 'spawned', key: '1:shell' })
  })

  it('survives a non-Error thrown by the spawn', () => {
    // node-pty is a native addon; what comes out of it is not guaranteed to be
    // an Error, and a message of "undefined" would render as a mystery in the
    // pane. Anything at all is better than a dead host.
    const mgr = fakeManager({ spawn: vi.fn(() => { throw 'ENOENT' }) })
    const { handle, posted } = harness(mgr)

    expect(() => handle({ t: 'spawn', key: '1:claude', cwd: 'C:/gone', session: { mode: 'new' } })).not.toThrow()
    expect(posted).toContainEqual({ t: 'spawn-failed', key: '1:claude', message: 'ENOENT' })
  })

  it('builds the manager once, on init, and wires its callbacks out', () => {
    const mgr = fakeManager()
    const createManager = vi.fn(() => mgr)
    const posted: HostOutbound[] = []
    const handle = createHostHandler({ post: m => { posted.push(m) }, createManager })

    handle({ t: 'init', shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/t' })
    handle({ t: 'init', shellPath: 'pwsh.exe', fallbackWarning: undefined, paneThemeFile: 'C:/x/t' })

    expect(createManager).toHaveBeenCalledTimes(1)
    expect(createManager).toHaveBeenCalledWith('pwsh.exe', undefined, 'C:/x/t')
    expect(mgr.onData).toHaveBeenCalled()
    expect(mgr.onExit).toHaveBeenCalled()
  })

  it('ignores everything until init has arrived', () => {
    // Unchanged behaviour, pinned: main queues until `ready`, so a message
    // before `init` means something is wrong upstream, not that this should
    // improvise a manager with no shell path.
    const mgr = fakeManager()
    const posted: HostOutbound[] = []
    const handle = createHostHandler({ post: m => { posted.push(m) }, createManager: () => mgr })

    handle({ t: 'spawn', key: '1:claude', cwd: 'C:/src', session: { mode: 'new' } })

    expect(mgr.spawn).not.toHaveBeenCalled()
    expect(posted).toEqual([])
  })

  it('acks kill-all for the quit handshake', () => {
    // before-quit waits on this ack; losing it makes bezel wait out its whole
    // shutdown timeout on every single quit.
    const mgr = fakeManager()
    const { handle, posted } = harness(mgr)

    handle({ t: 'kill-all' })

    expect(mgr.killAll).toHaveBeenCalled()
    expect(posted).toContainEqual({ t: 'killed-all' })
  })
})
