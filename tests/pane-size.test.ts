import { describe, it, expect } from 'vitest'
import { usableDimensions } from '../src/pane-size'

/**
 * What may be told to a pty.
 *
 * A pane that is not being displayed has no box to measure, and FitAddon
 * answers that question with whatever falls out of the arithmetic — zero,
 * negative, or NaN. Passing any of those on resizes a live shell to a size no
 * terminal can be. The parked shell pane already sits on a zero-height grid
 * track and goes through this path, so the case is not hypothetical. Guarding
 * here is what makes hiding a pane a rendering decision rather than a
 * correctness one.
 */
describe('usableDimensions', () => {
  it('passes a real measurement through', () => {
    expect(usableDimensions({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 40 })
  })

  // FitAddon's own "I cannot measure this" answer.
  it('rejects nothing at all', () => {
    expect(usableDimensions(undefined)).toBeNull()
  })

  // The hidden-pane case: a collapsed box measures zero.
  it('rejects a collapsed box', () => {
    expect(usableDimensions({ cols: 0, rows: 0 })).toBeNull()
  })

  it('rejects a collapse in only one axis', () => {
    expect(usableDimensions({ cols: 80, rows: 0 })).toBeNull()
    expect(usableDimensions({ cols: 0, rows: 24 })).toBeNull()
  })

  // Padding can exceed a zero-width box, so the arithmetic goes negative.
  it('rejects a negative measurement', () => {
    expect(usableDimensions({ cols: -4, rows: 24 })).toBeNull()
  })

  // A division by a zero cell size yields NaN or Infinity rather than a number.
  it('rejects a measurement that is not a finite number', () => {
    expect(usableDimensions({ cols: Number.NaN, rows: 24 })).toBeNull()
    expect(usableDimensions({ cols: 80, rows: Number.POSITIVE_INFINITY })).toBeNull()
  })

  // One column is a real, if miserable, terminal. The floor is what a pty
  // cannot be, not what is comfortable to read.
  it('accepts the smallest terminal that can exist', () => {
    expect(usableDimensions({ cols: 1, rows: 1 })).toEqual({ cols: 1, rows: 1 })
  })
})
