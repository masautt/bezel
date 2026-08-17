// The message set between main (pty-bridge) and the utility process (pty-host).
//
// Deliberately small: every method already on the `PtyManager` interface, plus
// two acks. It is a separate module so both ends import the SAME types and a
// message added to one without the other fails to compile rather than failing
// at runtime, where it would look like a pane that silently does nothing.
//
// `key` is typed as `string` rather than `PaneKey` on the wire: these values
// survive a structured-clone round trip, and a template-literal type asserts
// something about the sender that the receiver cannot verify. Both ends narrow
// at the boundary instead.

import type { SessionIntent } from '../src/tabs.js'

export type HostInbound =
  | { t: 'init'; shellPath: string; fallbackWarning: string | undefined; paneThemeFile: string }
  | { t: 'spawn'; key: string; cwd: string; session: SessionIntent }
  | { t: 'write'; key: string; data: string }
  | { t: 'resize'; key: string; cols: number; rows: number }
  | { t: 'kill'; key: string }
  | { t: 'kill-all' }
  | { t: 'prewarm'; cwd: string; delayMs?: number }
  | { t: 'discard-warm' }

export type HostOutbound =
  /**
   * First thing the host says, before it can be told anything.
   *
   * A `utilityProcess` is not listening the instant `fork()` returns, and
   * anything posted into that gap is DROPPED — silently, which is the whole
   * problem: the host never received `init`, never built a manager, and then
   * ignored every spawn while looking perfectly healthy in the process list.
   * The bridge queues until this arrives.
   */
  | { t: 'ready' }
  | { t: 'data'; key: string; data: string }
  | { t: 'exit'; key: string; code: number }
  /** Ack for one `spawn`. Carries the key because spawns overlap, and the
   *  claude session uuid because the renderer asks for a session without
   *  knowing its id and must learn the one it got — including a spare's,
   *  decided long before the tab that adopted it existed. */
  | { t: 'spawned'; key: string; sessionId?: string }
  /**
   * The other answer to a `spawn`: `nodePty.spawn` is a synchronous native call
   * that throws on a deleted cwd, an unexecutable shell, or a permissions error.
   *
   * It needs to be on the wire because the alternative is what used to happen —
   * the throw unwound out of the host's message listener and killed the host,
   * and a dead host is reported to EVERY live key at once. One pane opened at a
   * stale directory took down every terminal in every tab.
   *
   * `message` is rendered straight into the pane by `formatSpawnError`, which
   * predates the move to a utility process and was left unreachable by it.
   */
  | { t: 'spawn-failed'; key: string; message: string }
  /** Ack for `kill-all`, awaited by the quit handshake. */
  | { t: 'killed-all' }
