// Main's proxy for the pty host. Implements the same surface `main.ts` already
// calls, so every call site keeps its shape and never learns that the work
// moved to another process.
//
// See the pty utility-process design doc (private specs repo).
import type { PtyManager } from './pty-manager.js'
import type { PaneKey } from '../src/types.js'
import type { SessionIntent } from '../src/tabs.js'
import type { HostInbound, HostOutbound } from './pty-protocol.js'

/**
 * The bit of `Electron.UtilityProcess` this module uses.
 *
 * Injected rather than forked here, for the same reason `pty-manager` takes its
 * `SpawnFn` by injection: a fake driven by tests is then the real code path,
 * not a parallel one. An Electron utility process cannot be started under
 * vitest, so without this seam none of the fault handling below is testable.
 */
export interface HostHandle {
  postMessage(message: HostInbound): void
  /**
   * NOTE the shape: Electron delivers the message DIRECTLY here, unlike the
   * child side where `process.parentPort.on('message', e => e.data)` wraps it
   * in a MessageEvent. Reading `.data` on this side yields `undefined` and
   * throws on the first message — which presents as a host that starts, says
   * `ready`, and is then never spoken to again.
   */
  on(event: 'message', cb: (message: HostOutbound) => void): void
  on(event: 'exit', cb: (code: number) => void): void
  kill(): boolean
}

export interface PtyBridge extends Omit<PtyManager, 'spawn'> {
  /**
   * Resolves on the host's ack for THIS key — i.e. when the pty is actually
   * alive, which is what `pty:spawn` meant before the move and what the loading
   * screen gates on. Rejects if the host never answers.
   */
  spawn(key: PaneKey, cwd: string, intent: SessionIntent): Promise<string | null>
  /** Kill every pty and wait for the ack, then kill the host. See `before-quit`. */
  shutdown(timeoutMs: number): Promise<void>
}

export interface BridgeOptions {
  shellPath: string
  fallbackWarning: string | undefined
  paneThemeFile: string
  /**
   * How long to wait for a spawn ack before giving up on it. Generous: the
   * measured worst case for a cold first spawn is ~5.1s, and the pane-level
   * timeout downstream is longer still. A rejection here surfaces in the pane
   * as `[failed to start: …]`, so a value that merely looks slow must not trip.
   */
  spawnTimeoutMs?: number
}

const DEFAULT_SPAWN_TIMEOUT_MS = 30_000

/**
 * @param forkHost Starts a host and returns a handle to it. A FACTORY, not an
 * instance, because the bridge has to be able to replace a host that died —
 * the renderer's `[press any key to restart]` is only true if a fresh host can
 * be forked behind it.
 */
export function createPtyBridge(forkHost: () => HostHandle, opts: BridgeOptions): PtyBridge {
  const spawnTimeoutMs = opts.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS
  let host: HostHandle

  let onData: ((key: PaneKey, data: string) => void) | null = null
  let onExit: ((key: PaneKey, code: number) => void) | null = null

  /** Spawn acks not yet received, by key. */
  const pending = new Map<string, { resolve: (sessionId: string | null) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  /**
   * Keys the bridge believes have a live pty. Maintained so a host crash can
   * synthesize an exit for each — a pane attached to nothing must show the
   * restart prompt, not sit there looking alive and swallowing keystrokes.
   */
  const live = new Set<string>()
  let killedAll: (() => void) | null = null
  let hostDead = false

  /**
   * Outbound messages are queued until the host says `ready`.
   *
   * `utilityProcess.fork()` returns before the child has installed its message
   * listener, and Electron DROPS anything posted into that window rather than
   * buffering it. Posting `init` eagerly therefore produced a host that never
   * built a manager and silently ignored every spawn — a live process with no
   * children and no error anywhere.
   */
  let ready = false
  const outbox: HostInbound[] = []
  function send(message: HostInbound): void {
    if (ready) host.postMessage(message)
    else outbox.push(message)
  }

  function settle(key: string, err?: Error, sessionId: string | null = null) {
    const p = pending.get(key)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(key)
    if (err) p.reject(err)
    else p.resolve(sessionId)
  }

  /** Fail every in-flight spawn. Used on host death and on killAll. */
  function clearPending(reason: string) {
    for (const key of [...pending.keys()]) settle(key, new Error(reason))
  }

  /**
   * Fork a host and wire it up. Called once at construction, and again on the
   * first spawn after a host death — lazily rather than eagerly on `exit`, so a
   * host that crashes on startup cannot turn into a fork loop nobody asked for.
   */
  function attach(): void {
    host = forkHost()
    hostDead = false
    ready = false
    outbox.length = 0

    host.on('message', msg => {
      switch (msg.t) {
      case 'ready': {
        ready = true
        // Flush in the order they were asked for, so `init` still lands first.
        const queued = outbox.splice(0, outbox.length)
        for (const m of queued) host.postMessage(m)
        break
      }
      case 'data':
        onData?.(msg.key as PaneKey, msg.data)
        break
      case 'exit':
        live.delete(msg.key)
        onExit?.(msg.key as PaneKey, msg.code)
        break
      case 'spawned':
        live.add(msg.key)
        settle(msg.key, undefined, msg.sessionId ?? null)
        break
      case 'spawn-failed':
        // Deliberately NOT added to `live`, and deleted in case a previous pty
        // for this key was: a key left there would be handed a synthesized exit
        // on the next host death — a pane reporting that it died twice, having
        // never started once.
        live.delete(msg.key)
        settle(msg.key, new Error(msg.message))
        break
        case 'killed-all':
          live.clear()
          killedAll?.()
          break
      }
    })

    host.on('exit', () => {
      hostDead = true
      // Every pane is now attached to nothing. Feed the renderer's existing
      // dead-pane path — `[process exited — press any key to restart]` — rather
      // than leaving panes that look alive. The keystroke that follows lands in
      // `spawn`, which re-forks.
      const orphaned = [...live]
      live.clear()
      clearPending('pty host exited before the pane started')
      for (const key of orphaned) onExit?.(key as PaneKey, -1)
      killedAll?.()
    })

    send({
      t: 'init',
      shellPath: opts.shellPath,
      fallbackWarning: opts.fallbackWarning,
      paneThemeFile: opts.paneThemeFile,
    })
  }

  attach()

  return {
    spawn(key, cwd, intent) {
      // The restart path. `[press any key to restart]` reaches here after a host
      // death, and rejecting would make that prompt a dead end — the pane would
      // report `[failed to start: pty host is not running]` forever.
      if (hostDead) attach()
      // A respawn of the same key replaces the old pty host-side; drop any ack
      // still outstanding for it so the new one is what resolves.
      settle(key, new Error('superseded by a newer spawn for this pane'))
      return new Promise<string | null>((resolve, reject) => {
        const timer = setTimeout(
          () => settle(key, new Error(`pty host did not acknowledge spawn within ${spawnTimeoutMs}ms`)),
          spawnTimeoutMs
        )
        pending.set(key, { resolve, reject, timer })
        send({ t: 'spawn', key, cwd, session: intent })
      })
    },
    write(key, data) {
      send({ t: 'write', key, data })
    },
    resize(key, cols, rows) {
      send({ t: 'resize', key, cols, rows })
    },
    kill(key) {
      live.delete(key)
      settle(key, new Error('pane was killed before it started'))
      send({ t: 'kill', key })
    },
    killAll() {
      live.clear()
      // Also travels on `did-start-navigation`. Clearing here is what stops a
      // spawn in flight across a reload from resolving into a renderer that no
      // longer exists.
      clearPending('panes were killed before they started')
      send({ t: 'kill-all' })
    },
    prewarm(cwd, delayMs) {
      send({ t: 'prewarm', cwd, delayMs })
    },
    discardWarm() {
      send({ t: 'discard-warm' })
    },
    onData(cb) {
      onData = cb
    },
    onExit(cb) {
      onExit = cb
    },
    shutdown(timeoutMs) {
      if (hostDead) return Promise.resolve()
      return new Promise<void>(resolve => {
        // The timeout is the important half. A wedged host must not make bezel
        // unquittable, and killing the host kills its pwsh/conpty grandchildren
        // anyway — so the ack is the clean path, not the only one.
        const timer = setTimeout(finish, timeoutMs)
        function finish() {
          clearTimeout(timer)
          killedAll = null
          host.kill()
          resolve()
        }
        killedAll = finish
        send({ t: 'kill-all' })
      })
    },
  }
}
