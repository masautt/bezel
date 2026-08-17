// The pty host's message loop.
//
// Split out of `pty-host.ts` so it can be tested: that module touches
// `process.parentPort` at import time, which does not exist under vitest, and
// the fault path here — a spawn that throws — is the one thing in the host
// worth testing. Same reasoning as the `HostHandle` seam on the main side.
import type { PtyManager } from './pty-manager.js'
import type { PaneKey } from '../src/types.js'
import type { HostInbound, HostOutbound } from './pty-protocol.js'

export interface HostHandlerDeps {
  post(message: HostOutbound): void
  /** Builds the real manager. Injected so a test does not need node-pty. */
  createManager(
    shellPath: string,
    fallbackWarning: string | undefined,
    paneThemeFile: string
  ): PtyManager
}

/**
 * Whatever a native addon threw, as something renderable.
 *
 * node-pty is a native module and what comes out of it is not guaranteed to be
 * an Error. An empty message would reach the pane as `[failed to start: ]`,
 * which reads as a bug in bezel rather than a failure to spawn — the same
 * reasoning as `formatSpawnError`'s own fallback.
 */
function reason(err: unknown): string {
  if (err instanceof Error) return err.message || 'unknown error'
  return String(err)
}

export function createHostHandler(deps: HostHandlerDeps): (msg: HostInbound) => void {
  /** Set by `init`; every other message is ignored until it arrives. */
  let manager: PtyManager | null = null

  return function handle(msg: HostInbound): void {
    if (msg.t === 'init') {
      if (manager) return
      manager = deps.createManager(msg.shellPath, msg.fallbackWarning, msg.paneThemeFile)
      manager.onData((key, data) => deps.post({ t: 'data', key, data }))
      manager.onExit((key, code) => deps.post({ t: 'exit', key, code }))
      return
    }
    if (!manager) return

    switch (msg.t) {
      case 'spawn': {
        // The ack is posted AFTER spawn returns, which is the moment the pty is
        // actually alive. The renderer's `pty.spawn` promise — and therefore the
        // loading screen that gates on it — resolves on this and nothing else.
        // Acking on receipt instead would fade the overlay before either pane
        // existed and turn the feature into a lie.
        //
        // And the other outcome: an unguarded throw here does not fail THIS
        // pane, it kills the host and therefore every pane in every tab. Report
        // it against the key that caused it and stay up for the rest.
        let sessionId: string | null = null
        try {
          sessionId = manager.spawn(msg.key as PaneKey, msg.cwd, msg.session)
        } catch (err) {
          deps.post({ t: 'spawn-failed', key: msg.key, message: reason(err) })
          return
        }
        deps.post({ t: 'spawned', key: msg.key, sessionId: sessionId ?? undefined })
        break
      }
      case 'write':
        manager.write(msg.key as PaneKey, msg.data)
        break
      case 'resize':
        manager.resize(msg.key as PaneKey, msg.cols, msg.rows)
        break
      case 'kill':
        manager.kill(msg.key as PaneKey)
        break
      case 'kill-all':
        manager.killAll()
        deps.post({ t: 'killed-all' })
        break
      case 'prewarm':
        manager.prewarm(msg.cwd, msg.delayMs)
        break
      case 'discard-warm':
        manager.discardWarm()
        break
    }
  }
}
