// What may be told to a pty.
//
// A pane that is not being displayed has no box to measure, and FitAddon
// answers that with whatever falls out of the arithmetic: zero, a negative, or
// NaN from a division by a zero cell size. Passing any of those on resizes a
// LIVE shell to a size no terminal can be — a background tab's conpty quietly
// reshaped to 0x0 while its process keeps writing to it.
//
// bezel avoided this by construction, keeping inactive layers at full size with
// `visibility: hidden` so a collapsed box was never measured. That works, but it
// makes every way of putting a pane away a correctness question. The parked
// shell pane already sits on a zero-height grid track and goes through this same
// path, so the case is not hypothetical.
//
// Guarding the value itself is the smaller and more durable half of the same
// idea: with it, how a pane is hidden becomes a rendering decision rather than a
// correctness one.

export interface PaneDimensions {
  cols: number
  rows: number
}

/**
 * `dims` if a pty could actually be that size, otherwise null.
 *
 * The floor is one column and one row: what a pty cannot be, rather than what
 * is comfortable to read. A 1x1 terminal is miserable but real, and clamping to
 * some prettier minimum would invent a size the pane does not have.
 */
export function usableDimensions(dims: PaneDimensions | undefined): PaneDimensions | null {
  if (!dims) return null
  const { cols, rows } = dims
  // Number.isFinite rejects NaN and both infinities in one test; the
  // comparisons then rule out zero and negatives.
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null
  if (cols < 1 || rows < 1) return null
  return { cols, rows }
}
