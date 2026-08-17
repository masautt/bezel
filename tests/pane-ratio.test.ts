import { describe, it, expect } from 'vitest'
import { LAYOUT_KEY, RATIO_KEY, loadLayout, saveLayout, type StorageLike } from '../client/src/paneRatio'
import { DEFAULT_LAYOUT, resizeGutter, toggleCollapse } from '@shared/layout'

// The clamp bounds and reducers moved to src/layout.ts (see layout.test.ts);
// what is covered here is the storage edge and the one-time migration.
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    removeItem: k => { map.delete(k) },
  }
}

describe('loadLayout', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadLayout(fakeStorage())).toEqual(DEFAULT_LAYOUT)
  })

  it('reads a persisted layout back', () => {
    const custom = resizeGutter(toggleCollapse(DEFAULT_LAYOUT, 'right', 'specs'), 'left', 40)
    expect(loadLayout(fakeStorage({ [LAYOUT_KEY]: JSON.stringify(custom) }))).toEqual(custom)
  })

  it('repairs a corrupt persisted layout instead of throwing', () => {
    expect(loadLayout(fakeStorage({ [LAYOUT_KEY]: 'not json' }))).toEqual(DEFAULT_LAYOUT)
  })

  it('folds a pre-existing pane ratio into a fresh layout, then drops the old key', () => {
    // A user who had dragged the pane divider keeps that one dimension rather
    // than being silently reset to 0.75 by the upgrade.
    const storage = fakeStorage({ [RATIO_KEY]: '0.6' })
    expect(loadLayout(storage).paneRatio).toBe(0.6)
    expect(storage.getItem(RATIO_KEY)).toBeNull()
  })

  it('clamps a migrated ratio', () => {
    expect(loadLayout(fakeStorage({ [RATIO_KEY]: '1.5' })).paneRatio).toBe(0.9)
  })

  it('ignores the legacy key once a real layout exists', () => {
    const storage = fakeStorage({
      [LAYOUT_KEY]: JSON.stringify(DEFAULT_LAYOUT),
      [RATIO_KEY]: '0.4',
    })
    expect(loadLayout(storage).paneRatio).toBe(DEFAULT_LAYOUT.paneRatio)
  })
})

describe('saveLayout', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage()
    const custom = resizeGutter(DEFAULT_LAYOUT, 'right', 30)
    saveLayout(storage, custom)
    expect(loadLayout(storage)).toEqual(custom)
  })
})
