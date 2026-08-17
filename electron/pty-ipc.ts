// The renderer's side of the pty, and which calls are worth a reply.
//
// Extracted from main.ts for the same reason createPtyBridge and
// installCrashHandlers were: main cannot be loaded under vitest, so anything
// left inline there is untestable by construction. The rule this module encodes
// — one-way writes, request/response for everything else — is small enough to
// look obvious and expensive enough to be worth pinning.
import type { PaneKey } from '../src/types.js'
import type { SessionIntent } from '../src/tabs.js'

/**
 * The slice of `ipcMain` this module uses.
 *
 * Both halves are here on purpose: the CHOICE between them is the subject.
 * `handle` is a request/response pair — the renderer allocates a promise and
 * main sends a reply — and `on` is one-way.
 */
// `any[]` for the rest params, mirroring Electron's own IpcMain signature, and
// it has to be: rest parameters are checked contravariantly even on methods, so
// `unknown[]` here rejects every handler below that names its arguments — and
// rejects the real `ipcMain` as an argument too.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PtyIpcMain {
  handle(channel: string, listener: (e: unknown, ...args: any[]) => unknown): void
  on(channel: string, listener: (e: unknown, ...args: any[]) => void): void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The slice of the pty bridge these handlers drive. */
export interface PtyIpcTarget {
  spawn(key: PaneKey, cwd: string, intent: SessionIntent): Promise<string | null>
  write(key: PaneKey, data: string): void
  resize(key: PaneKey, cols: number, rows: number): void
  kill(key: PaneKey): void
}

/**
 * Wire the four pty channels.
 *
 * `pty:write` is one-way, and that is the whole point. It fires once per
 * KEYSTROKE, and under `handle` every one of them cost a reply message back
 * across the process boundary that nothing reads: main's handler returns
 * undefined and the renderer discards it. Halving the traffic on the one path
 * whose latency a user can feel directly is worth the asymmetry.
 *
 * Everything else keeps its reply because something genuinely waits on it —
 * spawn's ack is what lowers the launch screen and carries the session uuid
 * back, and TerminalPane sequences its restart path on resize's promise.
 *
 * `pty` is an accessor rather than the bridge itself: main builds the bridge
 * inside `whenReady` and throws from `pty()` until it exists.
 */
export function registerPtyIpc(
  ipc: PtyIpcMain,
  pty: () => PtyIpcTarget,
  onError: (err: unknown) => void,
): void {
  ipc.handle('pty:spawn', (_e, key: PaneKey, cwd: string, intent: SessionIntent) => pty().spawn(key, cwd, intent))
  ipc.handle('pty:resize', (_e, key: PaneKey, cols: number, rows: number) => pty().resize(key, cols, rows))
  ipc.handle('pty:kill', (_e, key: PaneKey) => pty().kill(key))

  ipc.on('pty:write', (_e, key: PaneKey, data: string) => {
    // The cost of going one-way, and it has to be paid here. Under `handle`,
    // Electron caught a throwing handler and turned it into a rejected promise
    // the renderer absorbed. Under `on` there is nobody to reject to, so the
    // same throw reaches `uncaughtException` — survivable only because
    // crash-handlers.ts installs a listener, and recorded in crash.log as a
    // fault the user never caused.
    //
    // Both reachable ways in are covered: `pty()` throws before the bridge
    // exists, and `write` throws when the host has died under it. Neither is
    // worth more than a line in the log — the pane's own dead-pty path is what
    // tells the user, and it is driven by the exit event, not by this.
    try {
      pty().write(key, data)
    } catch (err) {
      onError(err)
    }
  })
}
