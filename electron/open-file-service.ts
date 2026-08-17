export type OpenFileAction =
  | { kind: 'none' }
  | { kind: 'editor'; args: string[]; path: string }

/**
 * Decides what to do with a file path ctrl+clicked in a terminal pane.
 *
 * Pure, with `exists` injected, for the same reason resolveSpecTarget is: the
 * decision is a filesystem question the renderer cannot ask, and it needs to be
 * testable without one.
 *
 * A path that is not on this box resolves to `none` rather than being handed to
 * the editor. Terminal output is full of paths that only ever existed on another
 * machine — CI logs, pasted stack traces, README examples — and `code -g` on a
 * missing file silently creates an empty buffer for it.
 *
 * `args` targets `code -g`, which is the only form that honours the line number;
 * `path` is carried alongside for the caller's shell.openPath fallback, used when
 * `code` is not on PATH. That fallback loses the line, which is why it is second.
 */
export function resolveOpenFileAction(
  path: string,
  line: number | undefined,
  col: number | undefined,
  exists: (p: string) => boolean
): OpenFileAction {
  if (!exists(path)) return { kind: 'none' }

  // A column with no line addresses nothing — `code -g file::7` is not a location.
  let spec = path
  if (line !== undefined) {
    spec = `${path}:${line}`
    if (col !== undefined) spec = `${spec}:${col}`
  }
  return { kind: 'editor', args: ['-g', spec], path }
}
