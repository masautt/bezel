// Making crashes legible.
//
// main had no `uncaughtException` or `unhandledRejection` handler, so anything
// that threw on that thread exited the app having written nothing anywhere.
// That is why "bezel crashed" was never actionable: after the fact there was no
// way to tell a bad `webContents.send` from a GPU fault from a native addon.
//
// This does not make the app crash-proof, and it is not meant to. It keeps a
// survivable fault survivable, and leaves a line behind either way.

/**
 * One crash, as one line.
 *
 * The stack is the only part that locates the fault, so it wins over the
 * message when both exist. Never throws: a formatter that dies while formatting
 * a crash turns a logged fault into an unlogged one.
 */
export function formatCrash(scope: string, err: unknown, atIso: string): string {
  const detail = err instanceof Error ? err.stack || err.message : String(err)
  return `[${atIso}] ${scope}: ${detail}`
}

/**
 * The events, and what to do with them.
 *
 * Registering a listener for `uncaughtException` is itself the fix: Node's
 * default action for that event is to print and exit, and having ANY listener
 * suppresses it. That is a real trade — the process continues in a state the
 * author did not plan for — and it is the right one here, because the faults
 * this actually catches are a `send` into a destroyed webContents and a
 * best-effort background pull, neither of which is worth losing four live
 * terminals over.
 *
 * `proc` is injected rather than closed over so a test can drive it; `log` is
 * injected because this module must not know where userData is.
 */
export function installCrashHandlers(proc: NodeJS.EventEmitter, log: (line: string) => void): void {
  const record = (scope: string) => (err: unknown) => {
    try {
      log(formatCrash(scope, err, new Date().toISOString()))
    } catch {
      // The log lives on disk. A full disk or an unwritable userData directory
      // must not promote a survivable fault into a hard exit.
    }
  }
  proc.on('uncaughtException', record('uncaughtException'))
  proc.on('unhandledRejection', record('unhandledRejection'))
}
