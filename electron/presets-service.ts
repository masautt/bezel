import { getSupabase } from './supabase.js'
// A relative import, not the `@shared` alias: tsc does not rewrite path-mapped
// specifiers on emit, so a runtime import through the alias would resolve to a
// nonexistent "@shared" package once compiled.
import type { LayoutPreset, RemotePresetRow } from '../src/presets.js'

/** Scopes the shared table, so other devkit apps can use it without collision. */
const APP = 'bezel'
const TABLE = 'layout_presets'
const SCHEMA = 'sbrain_config'

/**
 * This module does I/O only. The merge policy — last-write-wins, tombstones,
 * never touching the built-in default — is `mergeRemotePresets` in src/presets.ts,
 * which is pure and fully tested without a network.
 *
 * Every function here returns null/false rather than throwing: preset sync is
 * best-effort by design, and the local config.json copy is authoritative for
 * everything that renders.
 */

/** Every row for this app, tombstones included — the merge needs to see deletes. */
export async function pullPresets(orgsRoot: string): Promise<RemotePresetRow[] | null> {
  const supabase = getSupabase(orgsRoot)
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from(TABLE)
      .select('id, name, layout, updated_at, deleted_at')
      .eq('app', APP)
    if (error) return null
    return data as RemotePresetRow[]
  } catch {
    return null
  }
}

/**
 * `updated_at` is written from the LOCAL stamp rather than left to the column
 * default, so the value the merge compares is the one the edit actually carried.
 * Letting the server clock win would make an edit look newer than it is the
 * moment it syncs, and an offline edit would lose to a later trivial one.
 *
 * `deleted_at: null` is explicit so re-pushing a preset that was tombstoned
 * elsewhere resurrects it — which is the intent when a local edit is newer than
 * a remote delete.
 */
export async function pushPresets(orgsRoot: string, presets: LayoutPreset[]): Promise<boolean> {
  if (presets.length === 0) return true
  const supabase = getSupabase(orgsRoot)
  if (!supabase) return false
  try {
    const rows = presets.map(p => ({
      id: p.id,
      app: APP,
      name: p.name,
      layout: p.layout,
      updated_at: p.updatedAt,
      deleted_at: null,
    }))
    const { error } = await supabase.schema(SCHEMA).from(TABLE).upsert(rows, { onConflict: 'id' })
    return !error
  } catch {
    return false
  }
}

/**
 * Soft delete. A hard delete would let any machine that still holds the preset
 * locally push it straight back up on its next startup — the tombstone is what
 * makes the deletion win.
 */
export async function tombstonePreset(orgsRoot: string, id: string, now: string): Promise<boolean> {
  const supabase = getSupabase(orgsRoot)
  if (!supabase) return false
  try {
    const { error } = await supabase
      .schema(SCHEMA)
      .from(TABLE)
      .update({ deleted_at: now, updated_at: now })
      .eq('app', APP)
      .eq('id', id)
    return !error
  } catch {
    return false
  }
}
