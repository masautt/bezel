import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LAYOUT, GUTTER_MIN, GUTTER_MAX, SLOT_MIN, SLOT_MAX,
  resizeGutter, resetGutter, setPaneRatio, resizeSlot, resetSlot,
  toggleCollapse, setHidden, moveSlot, parseLayout, toggleShellCollapsed,
} from '@shared/layout'

describe('resizeGutter', () => {
  it('widens the left gutter on a rightward drag', () => {
    expect(resizeGutter(DEFAULT_LAYOUT, 'left', 40).gutters.left).toBe(280)
  })

  it('NARROWS the right gutter on a rightward drag', () => {
    // The right divider sits to the LEFT of the right gutter, so moving it
    // rightward takes width away. Getting this backwards produces a gutter
    // that runs from the cursor rather than tracking it.
    expect(resizeGutter(DEFAULT_LAYOUT, 'right', 40).gutters.right).toBe(200)
  })

  it('clamps at both ends', () => {
    expect(resizeGutter(DEFAULT_LAYOUT, 'left', -9999).gutters.left).toBe(GUTTER_MIN)
    expect(resizeGutter(DEFAULT_LAYOUT, 'left', 9999).gutters.left).toBe(GUTTER_MAX)
    expect(resizeGutter(DEFAULT_LAYOUT, 'right', 9999).gutters.right).toBe(GUTTER_MIN)
    expect(resizeGutter(DEFAULT_LAYOUT, 'right', -9999).gutters.right).toBe(GUTTER_MAX)
  })

  it('leaves the other gutter and the slots untouched by reference', () => {
    const next = resizeGutter(DEFAULT_LAYOUT, 'left', 10)
    expect(next.gutters.right).toBe(DEFAULT_LAYOUT.gutters.right)
    expect(next.slots).toBe(DEFAULT_LAYOUT.slots)
  })

  it('returns the same object when already clamped', () => {
    const min = resizeGutter(DEFAULT_LAYOUT, 'left', -9999)
    expect(resizeGutter(min, 'left', -10)).toBe(min)
  })
})

describe('resetGutter', () => {
  it('restores a dragged gutter to its default width', () => {
    const dragged = resizeGutter(DEFAULT_LAYOUT, 'left', 100)
    expect(resetGutter(dragged, 'left').gutters.left).toBe(DEFAULT_LAYOUT.gutters.left)
  })

  it('restores the RIGHT gutter to its default, not to the minimum', () => {
    const dragged = resizeGutter(DEFAULT_LAYOUT, 'right', 200)
    expect(resetGutter(dragged, 'right').gutters.right).toBe(DEFAULT_LAYOUT.gutters.right)
  })
})

describe('setPaneRatio', () => {
  it('clamps to the pane bounds', () => {
    expect(setPaneRatio(DEFAULT_LAYOUT, 0.1).paneRatio).toBe(0.3)
    expect(setPaneRatio(DEFAULT_LAYOUT, 1.5).paneRatio).toBe(0.9)
  })

  it('returns the same object when unchanged', () => {
    expect(setPaneRatio(DEFAULT_LAYOUT, DEFAULT_LAYOUT.paneRatio)).toBe(DEFAULT_LAYOUT)
  })
})

describe('resizeSlot', () => {
  it('seeds an auto slot from its measured fraction on the first drag', () => {
    // Without the seed the widget jumps to SLOT_MIN + delta the instant it is
    // grabbed, because 'auto' has no number to add a delta to.
    const next = resizeSlot(DEFAULT_LAYOUT, 'left', 'context', 0.02, 0.15)
    expect(next.slots.left[0].height).toBeCloseTo(0.17)
  })

  it('adds to an existing fraction and ignores the seed', () => {
    const next = resizeSlot(DEFAULT_LAYOUT, 'left', 'changes', 0.05, 0.99)
    expect(next.slots.left[1].height).toBeCloseTo(0.5)
  })

  it('clamps to the slot bounds', () => {
    expect(resizeSlot(DEFAULT_LAYOUT, 'left', 'changes', -5, 0).slots.left[1].height).toBe(SLOT_MIN)
    expect(resizeSlot(DEFAULT_LAYOUT, 'left', 'changes', 5, 0).slots.left[1].height).toBe(SLOT_MAX)
  })

  it('is a no-op for an id that is not in that gutter', () => {
    expect(resizeSlot(DEFAULT_LAYOUT, 'left', 'specs', 0.1, 0.2)).toBe(DEFAULT_LAYOUT)
  })

  it('leaves sibling slots identical by reference', () => {
    const next = resizeSlot(DEFAULT_LAYOUT, 'left', 'changes', 0.05, 0)
    expect(next.slots.left[0]).toBe(DEFAULT_LAYOUT.slots.left[0])
    expect(next.slots.right).toBe(DEFAULT_LAYOUT.slots.right)
  })
})

describe('resetSlot', () => {
  it('restores a dragged slot to its default height', () => {
    const dragged = resizeSlot(DEFAULT_LAYOUT, 'left', 'changes', 0.2, 0)
    expect(resetSlot(dragged, 'left', 'changes').slots.left[1].height).toBe(DEFAULT_LAYOUT.slots.left[1].height)
  })

  it('restores a dragged auto slot back to auto', () => {
    const dragged = resizeSlot(DEFAULT_LAYOUT, 'left', 'context', 0.1, 0.2)
    expect(resetSlot(dragged, 'left', 'context').slots.left[0].height).toBe('auto')
  })
})

describe('toggleCollapse', () => {
  it('flips one slot and leaves its siblings identical by reference', () => {
    const next = toggleCollapse(DEFAULT_LAYOUT, 'right', 'specs')
    expect(next.slots.right[1].collapsed).toBe(true)
    expect(next.slots.right[0]).toBe(DEFAULT_LAYOUT.slots.right[0])
  })

  it('flips back', () => {
    const once = toggleCollapse(DEFAULT_LAYOUT, 'right', 'specs')
    expect(toggleCollapse(once, 'right', 'specs').slots.right[1].collapsed).toBe(false)
  })
})

describe('setHidden and moveSlot', () => {
  it('hides a slot', () => {
    expect(setHidden(DEFAULT_LAYOUT, 'right', 'window', true).slots.right[2].hidden).toBe(true)
  })

  it('is a no-op when the hidden state already matches', () => {
    expect(setHidden(DEFAULT_LAYOUT, 'right', 'window', false)).toBe(DEFAULT_LAYOUT)
  })

  it('moves a slot within its gutter', () => {
    expect(moveSlot(DEFAULT_LAYOUT, 'left', 'changes', -1).slots.left.map(s => s.id)).toEqual(['changes', 'context'])
  })

  it('refuses to move past either end', () => {
    expect(moveSlot(DEFAULT_LAYOUT, 'left', 'context', -1)).toBe(DEFAULT_LAYOUT)
    expect(moveSlot(DEFAULT_LAYOUT, 'left', 'changes', 1)).toBe(DEFAULT_LAYOUT)
  })
})

describe('parseLayout', () => {
  it('returns the defaults for junk', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{"gutters":42}')).toEqual(DEFAULT_LAYOUT)
  })

  it('clamps an out-of-range stored width rather than trusting it', () => {
    const raw = JSON.stringify({ ...DEFAULT_LAYOUT, gutters: { left: 4000, right: 1 } })
    const parsed = parseLayout(raw)
    expect(parsed.gutters.left).toBe(GUTTER_MAX)
    expect(parsed.gutters.right).toBe(GUTTER_MIN)
  })

  it('drops an unknown widget id and appends the missing ones', () => {
    // A layout written by a build with a different widget set must degrade to
    // a working layout, never crash inside a render.
    const raw = JSON.stringify({
      ...DEFAULT_LAYOUT,
      slots: { left: [{ id: 'servers', height: 'auto', collapsed: false, hidden: false }], right: [] },
    })
    const parsed = parseLayout(raw)
    expect(parsed.slots.left.map(s => s.id)).toEqual(['context', 'changes'])
    expect(parsed.slots.right.map(s => s.id)).toEqual(['session', 'specs', 'window', 'usage'])
  })

  it('preserves a stored order that differs from the default', () => {
    const reordered = moveSlot(DEFAULT_LAYOUT, 'left', 'changes', -1)
    expect(parseLayout(JSON.stringify(reordered)).slots.left.map(s => s.id)).toEqual(['changes', 'context'])
  })

  it('repairs a non-finite height', () => {
    const raw = '{"slots":{"left":[{"id":"changes","height":null},{"id":"context"}]}}'
    expect(parseLayout(raw).slots.left[0].height).toBe('auto')
  })

  it('round-trips a valid layout', () => {
    const custom = resizeGutter(toggleCollapse(DEFAULT_LAYOUT, 'right', 'specs'), 'left', 30)
    expect(parseLayout(JSON.stringify(custom))).toEqual(custom)
  })
})

describe('session slot height migration', () => {
  const stored = (id: string, height: 'auto' | number) => JSON.stringify({
    ...DEFAULT_LAYOUT,
    slots: {
      ...DEFAULT_LAYOUT.slots,
      right: [{ id, height, collapsed: false, hidden: false }],
    },
  })
  const heightOf = (raw: string, id: string) =>
    parseLayout(raw).slots.right.find(s => s.id === id)!.height

  it('sizes the session slot to its content by default', () => {
    expect(DEFAULT_LAYOUT.slots.right.find(s => s.id === 'session')!.height).toBe('auto')
  })

  // The old default, never a drag: nobody lands on 0.22 with the grabber.
  it('migrates the retired 0.22 default to auto', () => {
    expect(heightOf(stored('session', 0.22), 'session')).toBe('auto')
  })

  it('leaves a height the user actually dragged alone', () => {
    expect(heightOf(stored('session', 0.31), 'session')).toBe(0.31)
  })

  it('does not migrate 0.22 on any other slot', () => {
    expect(heightOf(stored('specs', 0.22), 'specs')).toBe(0.22)
  })
})

// The path a machine with a DRAGGED session height actually takes: the
// migration deliberately does not touch a real choice, so resetting the slot by
// double-clicking its grabber is what adopts the new auto default.
describe('resetting a dragged session slot', () => {
  it('returns it to auto', () => {
    const dragged = resizeSlot(DEFAULT_LAYOUT, 'right', 'session', -0.08, 0.22)
    expect(dragged.slots.right.find(s => s.id === 'session')!.height).not.toBe('auto')
    const reset = resetSlot(dragged, 'right', 'session')
    expect(reset.slots.right.find(s => s.id === 'session')!.height).toBe('auto')
  })
})

describe('toggleShellCollapsed', () => {
  it('starts not collapsed', () => {
    expect(DEFAULT_LAYOUT.shellCollapsed).toBe(false)
  })

  it('toggles', () => {
    const once = toggleShellCollapsed(DEFAULT_LAYOUT)
    expect(once.shellCollapsed).toBe(true)
    expect(toggleShellCollapsed(once).shellCollapsed).toBe(false)
  })

  // PANE_MIN floors paneRatio at 0.3, so collapsing cannot be expressed as a
  // ratio — and the split has to survive being put away, or restoring would
  // hand back a different layout than the one you collapsed.
  it('never disturbs paneRatio, so the old split returns exactly', () => {
    const dragged = setPaneRatio(DEFAULT_LAYOUT, 0.62)
    expect(toggleShellCollapsed(toggleShellCollapsed(dragged)).paneRatio).toBe(0.62)
  })

  it('round-trips through parseLayout', () => {
    expect(parseLayout(JSON.stringify(toggleShellCollapsed(DEFAULT_LAYOUT))).shellCollapsed).toBe(true)
  })

  it('defaults a garbage stored value to false rather than throwing', () => {
    expect(parseLayout(JSON.stringify({ ...DEFAULT_LAYOUT, shellCollapsed: 'yes' })).shellCollapsed).toBe(false)
  })
})
