// Layout persistence. The clamp bounds and the reducers now live in
// src/layout.ts (shared, and unit-testable without a DOM); what remains here is
// the storage edge — reading, writing, and the one-time migration off the old
// pane-ratio-only key.

import { DEFAULT_LAYOUT, parseLayout, clampPaneRatio, type Layout } from '@shared/layout'

export const LAYOUT_KEY = 'bezel.layout'
/** The pre-layout key. Read once, folded in, then removed. */
export const RATIO_KEY = 'bezel.paneRatio'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Injected storage rather than a direct `localStorage` reference so this stays
 * importable from the tests/electron/src tsc projects, which carry only the
 * ES2022 lib and no DOM types.
 */
export function loadLayout(storage: StorageLike): Layout {
  const stored = storage.getItem(LAYOUT_KEY)
  if (stored !== null) return parseLayout(stored)

  // First run after the upgrade: a user who had dragged the pane divider keeps
  // that one dimension instead of being silently reset to 0.75.
  const legacy = Number(storage.getItem(RATIO_KEY))
  if (!legacy) return DEFAULT_LAYOUT
  storage.removeItem(RATIO_KEY)
  return { ...DEFAULT_LAYOUT, paneRatio: clampPaneRatio(legacy) }
}

export function saveLayout(storage: StorageLike, layout: Layout): void {
  storage.setItem(LAYOUT_KEY, JSON.stringify(layout))
}

/**
 * One-time migration off the localStorage keys, now that the layout lives in
 * config.json as part of the preset store. Returns null when there is nothing
 * to migrate, so the caller can tell "never had one" from "had the defaults".
 *
 * Clears both keys, so this can only ever fire once.
 */
export function takeLocalLayout(storage: StorageLike): Layout | null {
  const stored = storage.getItem(LAYOUT_KEY)
  const legacy = storage.getItem(RATIO_KEY)
  if (stored === null && legacy === null) return null
  const layout = loadLayout(storage)
  storage.removeItem(LAYOUT_KEY)
  storage.removeItem(RATIO_KEY)
  return layout
}
