import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Credentials follow the existing shared `.config` convention
// (project_secrets_dotconfig) — that file already exists with zero setup, and is
// read here, in main, only. The service-role key is never handed to the
// renderer; every table read and write goes back over IPC.
//
// Located under the orgs root main derived from the home directory rather than a
// hardcoded absolute path, so it resolves on any machine.
const credsPath = (orgsRoot: string) => `${orgsRoot}/sbrain-inc/.config/supabase-creds.json`

let client: SupabaseClient | null | undefined

/**
 * The one Supabase client, or null when credentials are missing or unreadable.
 *
 * Memoized and shared: the Specs widget and the layout-preset sync both need it,
 * and a second per-feature copy would mean two clients, two credential reads,
 * and two places for the "unavailable" path to drift.
 *
 * Never throws. Every caller degrades to its own empty/unavailable state.
 */
export function getSupabase(orgsRoot: string): SupabaseClient | null {
  if (client !== undefined) return client
  try {
    const { url, serviceRoleKey } = JSON.parse(readFileSync(credsPath(orgsRoot), 'utf-8')) as {
      url: string
      serviceRoleKey: string
    }
    client = createClient(url, serviceRoleKey)
  } catch {
    client = null
  }
  return client
}
