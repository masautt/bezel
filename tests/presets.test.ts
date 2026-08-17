import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STORE, DEFAULT_PRESET_ID, activePreset, isDirty, setLive, applyPreset,
  savePresetAs, saveToActive, renamePreset, deletePreset, resetLive, parseStore,
  mergeRemotePresets, type RemotePresetRow,
} from '@shared/presets'
import { DEFAULT_LAYOUT, resizeGutter, toggleCollapse } from '@shared/layout'

const T1 = '2026-08-09T10:00:00.000Z'
const T2 = '2026-08-09T11:00:00.000Z'
const T3 = '2026-08-09T12:00:00.000Z'
const wide = resizeGutter(DEFAULT_LAYOUT, 'left', 60)

/** A store with one saved preset ('coding') holding the stock layout. */
const withCoding = savePresetAs(DEFAULT_STORE, 'coding', 'p1', T1)

describe('live layout vs presets', () => {
  it('drags land on live and leave every preset untouched', () => {
    // The whole reason live is separate: a pointermove must not dirty a synced row.
    const next = setLive(withCoding, wide)
    expect(next.live).toEqual(wide)
    expect(next.presets).toBe(withCoding.presets)
  })

  it('reports drift from the active preset', () => {
    expect(isDirty(withCoding)).toBe(false)
    expect(isDirty(setLive(withCoding, wide))).toBe(true)
  })

  it('applying a preset replaces live and sets the active id', () => {
    const drifted = setLive(withCoding, wide)
    const back = applyPreset(drifted, DEFAULT_PRESET_ID)
    expect(back.live).toEqual(DEFAULT_LAYOUT)
    expect(back.activeId).toBe(DEFAULT_PRESET_ID)
    expect(isDirty(back)).toBe(false)
  })

  it('is a no-op for an unknown preset id', () => {
    expect(applyPreset(withCoding, 'nope')).toBe(withCoding)
  })

  it('resetLive restores the stock layout without touching any preset', () => {
    const drifted = setLive(withCoding, wide)
    const reset = resetLive(drifted)
    expect(reset.live).toEqual(DEFAULT_LAYOUT)
    expect(reset.presets).toBe(drifted.presets)
  })
})

describe('savePresetAs', () => {
  it('copies LIVE, not the defaults and not the active preset', () => {
    // "Save this as" must mean this. Branching from anything else throws away
    // the drags that motivated saving in the first place.
    const store = savePresetAs(setLive(DEFAULT_STORE, wide), 'coding', 'p1', T1)
    expect(activePreset(store).layout).toEqual(wide)
  })

  it('activates the copy', () => {
    expect(savePresetAs(DEFAULT_STORE, 'coding', 'p1', T1).activeId).toBe('p1')
  })

  it('refuses a blank name', () => {
    expect(savePresetAs(DEFAULT_STORE, '   ', 'p1', T1)).toBe(DEFAULT_STORE)
  })

  it('refuses a duplicate name', () => {
    // Enforced here rather than by a DB constraint: a locally-legal state that
    // cannot sync would fail silently, where this can tell the user.
    expect(savePresetAs(withCoding, 'coding', 'p2', T2)).toBe(withCoding)
  })

  it('trims the name', () => {
    expect(activePreset(savePresetAs(DEFAULT_STORE, '  review  ', 'p1', T1)).name).toBe('review')
  })
})

describe('saveToActive', () => {
  it('commits live into the active preset and stamps it', () => {
    const store = saveToActive(setLive(withCoding, wide), T2)
    expect(activePreset(store).layout).toEqual(wide)
    expect(activePreset(store).updatedAt).toBe(T2)
    expect(isDirty(store)).toBe(false)
  })

  it('refuses to write into the built-in default', () => {
    // It must stay a stable way back to the stock layout.
    const store = setLive(DEFAULT_STORE, wide)
    expect(saveToActive(store, T2)).toBe(store)
  })
})

describe('renamePreset and deletePreset', () => {
  it('renames and restamps', () => {
    const store = renamePreset(withCoding, 'p1', '  review ', T2)
    expect(store.presets[1].name).toBe('review')
    expect(store.presets[1].updatedAt).toBe(T2)
  })

  it('refuses to rename the built-in default, a blank name, or a duplicate', () => {
    expect(renamePreset(withCoding, DEFAULT_PRESET_ID, 'mine', T2)).toBe(withCoding)
    expect(renamePreset(withCoding, 'p1', '   ', T2)).toBe(withCoding)
    const two = savePresetAs(withCoding, 'review', 'p2', T2)
    expect(renamePreset(two, 'p2', 'coding', T3)).toBe(two)
  })

  it('refuses to delete the built-in default', () => {
    // Independently of any disabled attribute — a keyboard path must not leave
    // the store with nothing to fall back to.
    expect(deletePreset(DEFAULT_STORE, DEFAULT_PRESET_ID)).toBe(DEFAULT_STORE)
  })

  it('activates default when the active preset is deleted', () => {
    expect(deletePreset(withCoding, 'p1').activeId).toBe(DEFAULT_PRESET_ID)
  })

  it('leaves the active id alone when deleting a different preset', () => {
    const two = savePresetAs(withCoding, 'review', 'p2', T2)   // active = p2
    expect(deletePreset(two, 'p1').activeId).toBe('p2')
  })

  it('is a no-op for an unknown id', () => {
    expect(deletePreset(withCoding, 'nope')).toBe(withCoding)
  })
})

describe('parseStore', () => {
  it('returns the default store for junk', () => {
    expect(parseStore(undefined)).toEqual(DEFAULT_STORE)
    expect(parseStore('nonsense')).toEqual(DEFAULT_STORE)
    expect(parseStore({ presets: 'no' })).toEqual(DEFAULT_STORE)
  })

  it('repairs a dangling activeId', () => {
    expect(parseStore({ presets: DEFAULT_STORE.presets, activeId: 'gone' }).activeId).toBe(DEFAULT_PRESET_ID)
  })

  it('reinstates a missing built-in default at index 0', () => {
    const parsed = parseStore({
      presets: [{ id: 'p1', name: 'coding', layout: DEFAULT_LAYOUT, updatedAt: T1 }],
      activeId: 'p1',
    })
    expect(parsed.presets[0].id).toBe(DEFAULT_PRESET_ID)
    expect(parsed.activeId).toBe('p1')
  })

  it('repairs one corrupt preset layout and leaves the others alone', () => {
    // config.json is hand-editable by design; a bad edit must not crash a render.
    const parsed = parseStore({
      presets: [
        DEFAULT_STORE.presets[0],
        { id: 'p1', name: 'coding', layout: { gutters: 42 }, updatedAt: T1 },
      ],
      activeId: 'p1',
    })
    expect(parsed.presets[1].layout).toEqual(DEFAULT_LAYOUT)
  })

  it('drops a preset with no usable id', () => {
    const parsed = parseStore({ presets: [DEFAULT_STORE.presets[0], { name: 'nameless' }], activeId: 'default' })
    expect(parsed.presets).toHaveLength(1)
  })

  it('round-trips a real store through JSON', () => {
    const store = saveToActive(setLive(withCoding, toggleCollapse(wide, 'right', 'specs')), T2)
    expect(parseStore(JSON.stringify(store))).toEqual(store)
  })
})

describe('mergeRemotePresets', () => {
  const row = (over: Partial<RemotePresetRow> = {}): RemotePresetRow => ({
    id: 'p1', name: 'coding', layout: DEFAULT_LAYOUT, updated_at: T1, deleted_at: null, ...over,
  })

  it('adds a remote-only preset', () => {
    const { store, push } = mergeRemotePresets(DEFAULT_STORE, [row({ id: 'p9', name: 'review' })])
    expect(store.presets.map(p => p.id)).toEqual([DEFAULT_PRESET_ID, 'p9'])
    expect(push).toEqual([])
  })

  it('marks a local-only preset for push', () => {
    const { push } = mergeRemotePresets(withCoding, [])
    expect(push.map(p => p.id)).toEqual(['p1'])
  })

  it('lets the newer updatedAt win, in each direction', () => {
    const localNewer = renamePreset(withCoding, 'p1', 'local-wins', T3)
    expect(mergeRemotePresets(localNewer, [row({ updated_at: T1 })]).push.map(p => p.name)).toEqual(['local-wins'])

    const remote = mergeRemotePresets(withCoding, [row({ name: 'remote-wins', updated_at: T3 })])
    expect(remote.store.presets[1].name).toBe('remote-wins')
    expect(remote.push).toEqual([])
  })

  it('applies a tombstone newer than the local copy', () => {
    const { store } = mergeRemotePresets(withCoding, [row({ deleted_at: T2 })])
    expect(store.presets.map(p => p.id)).toEqual([DEFAULT_PRESET_ID])
  })

  it('lets a local edit made AFTER the delete win over the tombstone', () => {
    const edited = renamePreset(withCoding, 'p1', 'resurrected', T3)
    const { store, push } = mergeRemotePresets(edited, [row({ deleted_at: T2 })])
    expect(store.presets.map(p => p.id)).toEqual([DEFAULT_PRESET_ID, 'p1'])
    expect(push.map(p => p.name)).toEqual(['resurrected'])
  })

  it('falls back to default when the active preset is tombstoned away', () => {
    const { store } = mergeRemotePresets(withCoding, [row({ deleted_at: T2 })])
    expect(store.activeId).toBe(DEFAULT_PRESET_ID)
  })

  it('never pushes or removes the built-in default', () => {
    // Its id is not a uuid and its content is a constant every machine would
    // otherwise race to overwrite.
    const { store, push } = mergeRemotePresets(DEFAULT_STORE, [
      { id: DEFAULT_PRESET_ID, name: 'default', layout: wide, updated_at: T3, deleted_at: T3 },
    ])
    expect(push).toEqual([])
    expect(store.presets.map(p => p.id)).toEqual([DEFAULT_PRESET_ID])
  })

  it('never syncs the live layout', () => {
    const drifted = setLive(withCoding, wide)
    const { store } = mergeRemotePresets(drifted, [row({ updated_at: T3, layout: DEFAULT_LAYOUT })])
    expect(store.live).toEqual(wide)
  })

  it('repairs a corrupt remote layout rather than trusting it', () => {
    const { store } = mergeRemotePresets(DEFAULT_STORE, [row({ id: 'p9', layout: { gutters: 'nope' } })])
    expect(store.presets[1].layout).toEqual(DEFAULT_LAYOUT)
  })

  it('normalizes key order coming back from jsonb, so isDirty stays honest', () => {
    // Postgres jsonb does not preserve key order: a layout sent as
    // {gutters, paneRatio, slots} comes back as {slots, gutters, paneRatio},
    // and slot objects as {id, height, hidden, collapsed}. isDirty compares
    // with JSON.stringify, so without parseLayout rebuilding every layout in a
    // fixed key order, a preset that had merely round-tripped through Supabase
    // would report permanent, un-clearable drift.
    const reordered = {
      slots: {
        left: [
          { id: 'context', height: 'auto', hidden: false, collapsed: false },
          { id: 'apps', height: 0.45, hidden: false, collapsed: false },
        ],
        right: [
          { id: 'session', height: 0.22, hidden: false, collapsed: false },
          { id: 'specs', height: 'auto', hidden: false, collapsed: false },
          { id: 'changes', height: 'auto', hidden: false, collapsed: false },
        ],
      },
      gutters: { right: 240, left: 240 },
      paneRatio: 0.75,
    }
    const { store } = mergeRemotePresets(DEFAULT_STORE, [row({ id: 'p9', layout: reordered })])
    const applied = applyPreset(store, 'p9')
    expect(applied.presets[1].layout).toEqual(DEFAULT_LAYOUT)
    expect(isDirty(applied)).toBe(false)
  })
})
