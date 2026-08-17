import { getSupabase, getSchemas } from './supabase.js'
// A relative import, not the `@shared` alias: tsc does not rewrite path-mapped
// specifiers on emit, so a runtime import through the alias would resolve to a
// nonexistent "@shared" package once compiled.
import type { LoadingMessage } from '../src/loading-messages.js'

/** Scopes the shared table, so other devkit apps can use it without collision. */
const APP = 'bezel'
const TABLE = 'loading_messages'

/**
 * The remote loading lines, or null when Supabase is unavailable.
 *
 * Best-effort in the strongest sense: this is never on the critical path. The
 * renderer already has a message on screen from its built-ins or its cache
 * before this is even called — see the note in the loading-screen design about
 * why it CANNOT be called any earlier. Anything this returns is for the NEXT
 * launch, so a failure costs nothing and is not worth reporting.
 *
 * Returns rows in table shape (`message`), not renderer shape (`text`);
 * normalizeMessages in src/loading-messages.ts accepts either, and converting
 * here would just be a second place for the shape to drift.
 */
export async function pullLoadingMessages(): Promise<Array<Pick<LoadingMessage, 'weight'> & { message: string }> | null> {
  const supabase = getSupabase()
  const schemas = getSchemas()
  if (!supabase || !schemas) return null
  try {
    const { data, error } = await supabase
      .schema(schemas.config)
      .from(TABLE)
      .select('message, weight')
      .eq('app', APP)
      // Tombstoned rows are filtered HERE rather than in the renderer, unlike
      // presets: there is no merge to run and no local edit to reconcile, so a
      // deleted line is simply gone. Sending it would only invite the renderer
      // to cache and display it.
      .is('deleted_at', null)
    if (error) return null
    return data as Array<{ message: string; weight: number }>
  } catch {
    return null
  }
}
