import { DEFAULT_LAYOUT, parseLayout, type Layout } from './layout.js'

// Named layout presets. Browser-safe and pure: no Date, no crypto, no storage.
// Timestamps and ids are injected by the caller, so every reducer is
// deterministic under test and the impure edges stay in the renderer/main.

export interface LayoutPreset {
  id: string
  name: string
  layout: Layout
  /**
   * ISO 8601, stamped LOCALLY on every mutation rather than read back from the
   * server. An edit made offline still orders correctly against a later remote
   * one; reading the server's clock instead would make an unsynced edit look
   * infinitely old and lose every conflict.
   */
  updatedAt: string
}

/**
 * `live` is what renders and is NOT the active preset.
 *
 * This is the one place the design changed once preset sync was added. Letting a
 * drag write straight into the active preset (the original plan) is pleasant
 * locally, but it makes every pointermove a change to a synced row — which is
 * exactly the traffic the local/cloud split exists to avoid. Separating them
 * lets `live` stay instant, local, and display-specific while a preset stays a
 * deliberate, portable snapshot.
 *
 * The cost is an explicit Save, softened by `isDirty` so the UI can show the
 * active preset has drifted.
 */
export interface LayoutStore {
  /** What actually renders. Every drag lands here. Never synced. */
  live: Layout
  /** Named snapshots. `presets[0]` is always the built-in default. Synced. */
  presets: LayoutPreset[]
  /** Which preset was last applied. UI state; not a claim that `live` matches it. */
  activeId: string
}

export const DEFAULT_PRESET_ID = 'default'

// A constant rather than a call, so DEFAULT_STORE stays a pure value and the
// built-in preset always loses a last-write-wins comparison against a real edit.
const EPOCH = '1970-01-01T00:00:00.000Z'

export const DEFAULT_STORE: LayoutStore = {
  live: DEFAULT_LAYOUT,
  presets: [{ id: DEFAULT_PRESET_ID, name: 'default', layout: DEFAULT_LAYOUT, updatedAt: EPOCH }],
  activeId: DEFAULT_PRESET_ID,
}

export function activePreset(store: LayoutStore): LayoutPreset {
  return store.presets.find(p => p.id === store.activeId) ?? store.presets[0]
}

/** True when `live` has drifted from the preset it was applied from. */
export function isDirty(store: LayoutStore): boolean {
  return JSON.stringify(store.live) !== JSON.stringify(activePreset(store).layout)
}

/** Every drag funnels through here. Local only — no timestamp, nothing synced. */
export function setLive(store: LayoutStore, live: Layout): LayoutStore {
  return live === store.live ? store : { ...store, live }
}

export function applyPreset(store: LayoutStore, id: string): LayoutStore {
  const preset = store.presets.find(p => p.id === id)
  if (!preset) return store
  return { ...store, live: preset.layout, activeId: id }
}

function withPresets(store: LayoutStore, presets: LayoutPreset[]): LayoutStore {
  return { ...store, presets }
}

/**
 * "Save as" copies `live` — not DEFAULT_LAYOUT, and not the active preset's
 * stored layout. Branching from anything else would throw away the drags that
 * motivated saving. Activates the copy so the next Save does not silently
 * overwrite the preset it was branched from.
 */
export function savePresetAs(store: LayoutStore, name: string, id: string, now: string): LayoutStore {
  const clean = name.trim()
  // Uniqueness is enforced here rather than by a DB constraint: a locally-legal
  // state that cannot sync would fail silently, where this can tell the user.
  if (!clean || store.presets.some(p => p.name === clean)) return store
  const preset: LayoutPreset = { id, name: clean, layout: store.live, updatedAt: now }
  return { ...store, presets: [...store.presets, preset], activeId: id }
}

/** Commit `live` into the active preset. Refused for the built-in default,
 *  which must stay a stable way back to the stock layout. */
export function saveToActive(store: LayoutStore, now: string): LayoutStore {
  if (store.activeId === DEFAULT_PRESET_ID) return store
  const index = store.presets.findIndex(p => p.id === store.activeId)
  if (index === -1) return store
  const next = [...store.presets]
  next[index] = { ...next[index], layout: store.live, updatedAt: now }
  return withPresets(store, next)
}

export function renamePreset(store: LayoutStore, id: string, name: string, now: string): LayoutStore {
  const clean = name.trim()
  if (id === DEFAULT_PRESET_ID || !clean) return store
  if (store.presets.some(p => p.name === clean && p.id !== id)) return store
  const index = store.presets.findIndex(p => p.id === id)
  if (index === -1) return store
  const next = [...store.presets]
  next[index] = { ...next[index], name: clean, updatedAt: now }
  return withPresets(store, next)
}

/**
 * Deleting the active preset falls back to the built-in default, which is itself
 * undeletable — the reducer refuses independently of any disabled attribute, so
 * a keyboard path cannot leave the store with nothing to fall back to.
 */
export function deletePreset(store: LayoutStore, id: string): LayoutStore {
  if (id === DEFAULT_PRESET_ID) return store
  const presets = store.presets.filter(p => p.id !== id)
  if (presets.length === store.presets.length) return store
  return {
    ...store,
    presets,
    activeId: store.activeId === id ? DEFAULT_PRESET_ID : store.activeId,
  }
}

/** Restore `live` to the stock layout without touching any saved preset. */
export function resetLive(store: LayoutStore): LayoutStore {
  return setLive(store, DEFAULT_LAYOUT)
}

function parsePreset(raw: unknown): LayoutPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<LayoutPreset>
  if (typeof p.id !== 'string' || !p.id) return null
  return {
    id: p.id,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : p.id,
    layout: parseLayout(p.layout as never),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : EPOCH,
  }
}

/**
 * Validate and repair rather than trust: config.json is hand-editable by design,
 * and a bad edit must not be able to crash a render.
 */
export function parseStore(raw: unknown): LayoutStore {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return DEFAULT_STORE }
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_STORE

  const obj = parsed as Partial<LayoutStore>
  const seen = new Set<string>()
  const presets: LayoutPreset[] = []
  if (Array.isArray(obj.presets)) {
    for (const raw of obj.presets) {
      const preset = parsePreset(raw)
      if (!preset || seen.has(preset.id)) continue
      seen.add(preset.id)
      presets.push(preset)
    }
  }
  // The built-in default is reinstated at index 0 whenever it is missing, so
  // there is always a way back to the stock layout.
  const withDefault = seen.has(DEFAULT_PRESET_ID)
    ? [...presets].sort((a, b) => (a.id === DEFAULT_PRESET_ID ? -1 : b.id === DEFAULT_PRESET_ID ? 1 : 0))
    : [DEFAULT_STORE.presets[0], ...presets]

  const activeId = typeof obj.activeId === 'string' && withDefault.some(p => p.id === obj.activeId)
    ? obj.activeId
    : DEFAULT_PRESET_ID

  return {
    live: parseLayout(obj.live as never),
    presets: withDefault,
    activeId,
  }
}

// ── Supabase sync ────────────────────────────────────────────────────────────

/** One row of the remote layout_presets table, as PostgREST returns it. */
export interface RemotePresetRow {
  id: string
  name: string
  layout: unknown
  updated_at: string
  deleted_at: string | null
}

export interface MergeResult {
  store: LayoutStore
  /** Presets the caller should upsert remotely: local-only, or locally newer. */
  push: LayoutPreset[]
}

/**
 * Reconcile the local preset library against the remote rows. Pure, so the whole
 * sync policy is testable without a network.
 *
 * The built-in default is skipped in both directions: its id is not a uuid, and
 * its content is a constant every machine would otherwise race to overwrite.
 */
export function mergeRemotePresets(store: LayoutStore, rows: RemotePresetRow[]): MergeResult {
  const byId = new Map(store.presets.map(p => [p.id, p]))
  const push: LayoutPreset[] = []
  const removed = new Set<string>()

  for (const row of rows) {
    if (row.id === DEFAULT_PRESET_ID) continue
    const local = byId.get(row.id)

    if (row.deleted_at) {
      // A tombstone wins unless the local copy was edited after the delete —
      // in which case the local edit is the newer intent and goes back up.
      if (local && local.updatedAt <= row.deleted_at) removed.add(row.id)
      else if (local) push.push(local)
      continue
    }

    if (!local) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        layout: parseLayout(row.layout as never),
        updatedAt: row.updated_at,
      })
      continue
    }
    if (local.updatedAt > row.updated_at) push.push(local)
    else if (local.updatedAt < row.updated_at) {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        layout: parseLayout(row.layout as never),
        updatedAt: row.updated_at,
      })
    }
  }

  // Anything local the remote has never seen.
  const remoteIds = new Set(rows.map(r => r.id))
  for (const preset of store.presets) {
    if (preset.id === DEFAULT_PRESET_ID) continue
    if (!remoteIds.has(preset.id)) push.push(preset)
  }

  const presets = [...byId.values()].filter(p => !removed.has(p.id))
  const activeId = presets.some(p => p.id === store.activeId) ? store.activeId : DEFAULT_PRESET_ID
  return { store: { ...store, presets, activeId }, push }
}
