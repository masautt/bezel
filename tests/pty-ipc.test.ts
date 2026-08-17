import { describe, it, expect, vi } from 'vitest'
import { registerPtyIpc, type PtyIpcMain, type PtyIpcTarget } from '../electron/pty-ipc'

/**
 * A stand-in for `ipcMain` that remembers HOW each channel was registered.
 *
 * The distinction is the whole point of this module: `handle` is a
 * request/response pair — main sends a reply the renderer must allocate a
 * promise for — and `on` is one-way. For `pty:write`, which fires once per
 * keystroke, that reply is pure overhead nobody reads.
 */
function fakeIpc() {
  const handlers = new Map<string, (e: unknown, ...args: never[]) => unknown>()
  const listeners = new Map<string, (e: unknown, ...args: never[]) => void>()
  const ipc: PtyIpcMain = {
    handle: (channel, listener) => { handlers.set(channel, listener) },
    on: (channel, listener) => { listeners.set(channel, listener) },
  }
  return {
    ipc,
    handleChannels: () => [...handlers.keys()],
    oneWayChannels: () => [...listeners.keys()],
    invoke: (channel: string, ...args: unknown[]) =>
      handlers.get(channel)?.({}, ...(args as never[])),
    send: (channel: string, ...args: unknown[]) =>
      listeners.get(channel)?.({}, ...(args as never[])),
  }
}

function fakeTarget(overrides: Partial<PtyIpcTarget> = {}): PtyIpcTarget {
  return {
    spawn: vi.fn().mockResolvedValue(null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  }
}

describe('registerPtyIpc', () => {
  // The perf property this module exists for, stated as a rule rather than
  // left to a reviewer noticing `handle` vs `on`. Reverting it would double
  // the IPC traffic on the one path the user can feel — their own typing.
  it('registers writes one-way, with no reply for the renderer to await', () => {
    const ipc = fakeIpc()

    registerPtyIpc(ipc.ipc, () => fakeTarget(), () => {})

    expect(ipc.oneWayChannels()).toContain('pty:write')
    expect(ipc.handleChannels()).not.toContain('pty:write')
  })

  it('forwards a write to the pty', () => {
    const ipc = fakeIpc()
    const target = fakeTarget()

    registerPtyIpc(ipc.ipc, () => target, () => {})
    ipc.send('pty:write', '1:shell', 'ls\r')

    expect(target.write).toHaveBeenCalledWith('1:shell', 'ls\r')
  })

  // The cost of going one-way. Under `handle`, Electron caught a throwing
  // handler and turned it into a rejected promise the renderer absorbed. Under
  // `on` there is nobody to reject to, so the same throw reaches
  // `uncaughtException` — survivable only because crash-handlers.ts installs a
  // listener, and logged as a crash the user never caused. The pty host dying
  // mid-session is a real way to get here.
  it('reports a failed write instead of throwing out of the listener', () => {
    const ipc = fakeIpc()
    const boom = new Error('pty host is not running')
    const onError = vi.fn()

    registerPtyIpc(ipc.ipc, () => fakeTarget({ write: () => { throw boom } }), onError)

    expect(() => ipc.send('pty:write', '1:shell', 'x')).not.toThrow()
    expect(onError).toHaveBeenCalledWith(boom)
  })

  // A dead host is reached through the accessor, not the target: main's `pty()`
  // throws outright before the bridge exists. Same rule applies.
  it('reports a pty that cannot be reached at all', () => {
    const ipc = fakeIpc()
    const onError = vi.fn()

    registerPtyIpc(ipc.ipc, () => { throw new Error('the pty host has not been started yet') }, onError)

    expect(() => ipc.send('pty:write', '1:shell', 'x')).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  // spawn stays request/response: the renderer gates its launch screen on the
  // ack and needs the session uuid back. resize stays too — TerminalPane
  // sequences the restart path on its promise.
  it('keeps spawn a request/response call that answers with the session id', async () => {
    const ipc = fakeIpc()
    const target = fakeTarget({ spawn: vi.fn().mockResolvedValue('uuid-1') })

    registerPtyIpc(ipc.ipc, () => target, () => {})
    const answer = await ipc.invoke('pty:spawn', '1:claude', 'C:/src', { mode: 'new' })

    expect(target.spawn).toHaveBeenCalledWith('1:claude', 'C:/src', { mode: 'new' })
    expect(answer).toBe('uuid-1')
  })

  it('keeps resize and kill as request/response calls', () => {
    const ipc = fakeIpc()

    registerPtyIpc(ipc.ipc, () => fakeTarget(), () => {})

    expect(ipc.handleChannels()).toEqual(expect.arrayContaining(['pty:spawn', 'pty:resize', 'pty:kill']))
  })
})
