// Electron wraps every rejected ipcRenderer.invoke in its own prefix and appends
// the main-process stack, so the useful sentence arrives buried in noise:
//   Error invoking remote method 'pty:spawn': Error: spawn pwsh.exe ENOENT
//       at IpcMainImpl.<anonymous> (...)
const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*/
// Node's own "Error: " label survives the prefix strip and adds nothing.
const ERROR_LABEL = /^Error:\s*/

/**
 * One-line, terminal-safe rendering of a rejected pty spawn.
 *
 * Single-line is a hard requirement, not tidiness: this is written straight
 * into xterm, and an embedded newline without a carriage return leaves the
 * cursor mid-row and desyncs every subsequent frame the pane draws.
 */
export function formatSpawnError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const cleaned = raw
    .replace(REMOTE_PREFIX, '')
    // Drop the appended stack — frames start on their own line with "at ".
    .split(/\n\s*at\s/)[0]
    .replace(ERROR_LABEL, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A rejection with no message at all (`reject()`, or `new Error('')`) would
  // otherwise render as "[failed to start: ]", which reads like a UI bug.
  return cleaned || 'unknown error'
}
