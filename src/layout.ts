// Every adjustable dimension in the app, as one plain value. Browser-safe: no
// Node builtins, no DOM access, no storage — Vite bundles this into the
// renderer, and the reducers below must stay unit-testable without a document.
//
// Deliberately plain data (numbers, strings, booleans). The settings/preset
// work persists this object to config.json and diffs presets against each
// other, and both are trivial only while it stays serializable.

export type WidgetId = 'context' | 'session' | 'specs' | 'changes' | 'window' | 'usage'
export type GutterSide = 'left' | 'right'

export interface SlotState {
  id: WidgetId
  /** 'auto' = size to content. A number is a fraction (0..1) of the gutter's
   *  content height, at which the widget scrolls internally. */
  height: 'auto' | number
  collapsed: boolean
  /** Driven by the settings modal. Always false until then. */
  hidden: boolean
}

export interface Layout {
  /** Gutter widths in CSS pixels. A gutter holds text at a fixed font size, so
   *  its useful width does not scale with the window — unlike slot heights. */
  gutters: { left: number; right: number }
  /** The claude pane's share of the center column, 0..1. */
  paneRatio: number
  /** The shell pane is parked at the bottom, its divider left visible as the
   *  handle that brings it back. Separate from `paneRatio` rather than a ratio
   *  of 1: PANE_MIN floors that at 0.3, and the split has to survive being put
   *  away so restoring returns the layout you collapsed, not a default. */
  shellCollapsed: boolean
  /** Array order is render order within the gutter. */
  slots: Record<GutterSide, SlotState[]>
}

/** Below this, a repo name like "sbrain-finapp-comp" stops being readable. */
export const GUTTER_MIN = 160
/** Above this, the center column stops reading as a centered column. */
export const GUTTER_MAX = 520
/** Roughly a header plus one row. */
export const SLOT_MIN = 0.08
/** Never squeeze every sibling out at once. */
export const SLOT_MAX = 0.9

export const PANE_MIN = 0.3
export const PANE_MAX = 0.9

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampGutter(px: number): number {
  return clamp(Math.round(px), GUTTER_MIN, GUTTER_MAX)
}

export function clampSlot(fraction: number): number {
  return clamp(fraction, SLOT_MIN, SLOT_MAX)
}

export function clampPaneRatio(ratio: number): number {
  return clamp(ratio, PANE_MIN, PANE_MAX)
}

/**
 * The Session slot's height before it became `'auto'`.
 *
 * A stored value equal to this is the OLD DEFAULT rather than a drag — nobody
 * lands on 0.22 with the grabber — so it is migrated instead of honoured.
 * Without this the new default would change nothing on any machine that has
 * already written a layout, which is every machine. Any other number is a real
 * choice and is left exactly alone.
 */
const RETIRED_SESSION_HEIGHT = 0.22

const slot = (id: WidgetId, height: 'auto' | number = 'auto'): SlotState =>
  ({ id, height, collapsed: false, hidden: false })

/**
 * 240px and 0.75 reproduce the pre-adjustable appearance exactly, so a user who
 * never drags anything sees no change.
 *
 * `session` carried a 0.22 fraction for a while — it was once the only `grow`
 * widget in its gutter and claimed 100% of the leftover height by construction.
 * Its siblings are all `'auto'` now, so the fraction bought nothing and cost the
 * widget the ability to grow with what it holds. See RETIRED_SESSION_HEIGHT.
 *
 * The split is by SUBJECT, which is also why Changes moved left when the Apps
 * widget went away: the left gutter answers "where am I" (which repo, which
 * branch, what is dirty) and the right one answers "what is this session doing"
 * — its history, its specs, and at the bottom the two gauges that say how much
 * room is left to keep doing it. The gauges are last on purpose: they are
 * glanced at, not read, so they belong where the eye lands after everything
 * else rather than above content that is actually read.
 */
export const DEFAULT_LAYOUT: Layout = {
  gutters: { left: 240, right: 240 },
  paneRatio: 0.75,
  shellCollapsed: false,
  slots: {
    left: [slot('context'), slot('changes', 0.45)],
    right: [slot('session'), slot('specs'), slot('window'), slot('usage')],
  },
}

/** The left divider sits to the RIGHT of the left gutter and vice versa, so a
 *  rightward drag widens the left gutter and narrows the right one. */
export function resizeGutter(layout: Layout, side: GutterSide, deltaPx: number): Layout {
  const next = clampGutter(layout.gutters[side] + (side === 'right' ? -deltaPx : deltaPx))
  if (next === layout.gutters[side]) return layout
  return { ...layout, gutters: { ...layout.gutters, [side]: next } }
}

export function resetGutter(layout: Layout, side: GutterSide): Layout {
  const next = DEFAULT_LAYOUT.gutters[side]
  if (next === layout.gutters[side]) return layout
  return { ...layout, gutters: { ...layout.gutters, [side]: next } }
}

export function setPaneRatio(layout: Layout, ratio: number): Layout {
  const next = clampPaneRatio(ratio)
  return next === layout.paneRatio ? layout : { ...layout, paneRatio: next }
}

function mapSlot(
  layout: Layout,
  side: GutterSide,
  id: WidgetId,
  fn: (s: SlotState) => SlotState
): Layout {
  const slots = layout.slots[side]
  const index = slots.findIndex(s => s.id === id)
  if (index === -1) return layout
  const next = fn(slots[index])
  if (next === slots[index]) return layout
  const replaced = [...slots]
  replaced[index] = next
  return { ...layout, slots: { ...layout.slots, [side]: replaced } }
}

/**
 * `seed` is the slot's currently measured fraction, used only while its height
 * is still 'auto'. Passing it in keeps this pure — the DOM measurement belongs
 * to the component that owns the element — and stops the widget jumping to
 * SLOT_MIN the instant it is grabbed.
 */
export function resizeSlot(
  layout: Layout,
  side: GutterSide,
  id: WidgetId,
  deltaRatio: number,
  seed: number
): Layout {
  return mapSlot(layout, side, id, s => {
    const base = typeof s.height === 'number' ? s.height : seed
    const height = clampSlot(base + deltaRatio)
    return height === s.height ? s : { ...s, height }
  })
}

export function resetSlot(layout: Layout, side: GutterSide, id: WidgetId): Layout {
  const fallback = DEFAULT_LAYOUT.slots[side].find(s => s.id === id)?.height ?? 'auto'
  return mapSlot(layout, side, id, s => (s.height === fallback ? s : { ...s, height: fallback }))
}

/** Park the shell pane at the bottom, or bring it back. */
export function toggleShellCollapsed(layout: Layout): Layout {
  return { ...layout, shellCollapsed: !layout.shellCollapsed }
}

export function toggleCollapse(layout: Layout, side: GutterSide, id: WidgetId): Layout {
  return mapSlot(layout, side, id, s => ({ ...s, collapsed: !s.collapsed }))
}

export function setHidden(layout: Layout, side: GutterSide, id: WidgetId, hidden: boolean): Layout {
  return mapSlot(layout, side, id, s => (s.hidden === hidden ? s : { ...s, hidden }))
}

/** Move a slot one position within its gutter. Out-of-range moves are no-ops. */
export function moveSlot(layout: Layout, side: GutterSide, id: WidgetId, delta: -1 | 1): Layout {
  const slots = layout.slots[side]
  const from = slots.findIndex(s => s.id === id)
  const to = from + delta
  if (from === -1 || to < 0 || to >= slots.length) return layout
  const reordered = [...slots]
  const [moved] = reordered.splice(from, 1)
  reordered.splice(to, 0, moved)
  return { ...layout, slots: { ...layout.slots, [side]: reordered } }
}

function parseSlots(side: GutterSide, stored: unknown): SlotState[] {
  const defaults = DEFAULT_LAYOUT.slots[side]
  const known = new Map(defaults.map(s => [s.id, s]))
  const out: SlotState[] = []
  const seen = new Set<WidgetId>()

  if (Array.isArray(stored)) {
    for (const raw of stored) {
      const id = (raw as SlotState)?.id
      // Unknown ids (a widget this build no longer has, or one belonging to the
      // other gutter) are dropped rather than rendered as a hole.
      if (!known.has(id) || seen.has(id)) continue
      seen.add(id)
      const height = (raw as SlotState).height
      out.push({
        id,
        height: typeof height === 'number' && Number.isFinite(height)
          // Migration, not clamping: see RETIRED_SESSION_HEIGHT.
          ? (id === 'session' && height === RETIRED_SESSION_HEIGHT ? 'auto' : clampSlot(height))
          : 'auto',
        collapsed: (raw as SlotState).collapsed === true,
        hidden: (raw as SlotState).hidden === true,
      })
    }
  }
  // Anything the stored layout never mentioned is appended in default order, so
  // a layout written by an older build gains this build's new widgets.
  for (const d of defaults) if (!seen.has(d.id)) out.push(d)
  return out
}

/**
 * Validate and repair rather than trust. A layout written by a different build
 * — or hand-edited, which putting this in config.json invites — must degrade to
 * a working layout, never crash inside a render.
 */
export function parseLayout(raw: string | null | undefined): Layout {
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return DEFAULT_LAYOUT
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_LAYOUT

  const obj = parsed as Partial<Layout>
  const gutters = obj.gutters
  const left = typeof gutters?.left === 'number' && Number.isFinite(gutters.left)
    ? clampGutter(gutters.left)
    : DEFAULT_LAYOUT.gutters.left
  const right = typeof gutters?.right === 'number' && Number.isFinite(gutters.right)
    ? clampGutter(gutters.right)
    : DEFAULT_LAYOUT.gutters.right

  return {
    gutters: { left, right },
    paneRatio: typeof obj.paneRatio === 'number' && Number.isFinite(obj.paneRatio)
      ? clampPaneRatio(obj.paneRatio)
      : DEFAULT_LAYOUT.paneRatio,
    // Strict true, so anything else a hand-edited file holds reads as false —
    // the state a user can always get out of.
    shellCollapsed: obj.shellCollapsed === true,
    slots: {
      left: parseSlots('left', obj.slots?.left),
      right: parseSlots('right', obj.slots?.right),
    },
  }
}
