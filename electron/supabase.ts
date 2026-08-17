import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseCredsPath } from './config-paths.js'

/**
 * The schema names to address, read from the credentials file rather than
 * compiled in. PostgREST needs a non-public schema named explicitly on every
 * request, so these are required rather than optional — but they describe a
 * particular database, not this application, and so they belong with the
 * credentials that reach it. See config-paths.ts for why.
 */
export type Schemas = { config: string; docs: string }

type Creds = { url: string; serviceRoleKey: string; schemas: Schemas }

let creds: Creds | null | undefined

/**
 * The parsed credentials, or null when the file is missing, unreadable, or
 * incomplete. A file that predates the `schemas` block counts as incomplete:
 * without schema names there is nothing valid to query, so it degrades to the
 * same "unavailable" state as no credentials at all rather than failing later
 * with a confusing PostgREST error.
 */
function readCreds(): Creds | null {
  if (creds !== undefined) return creds
  try {
    const parsed = JSON.parse(readFileSync(supabaseCredsPath(), 'utf-8')) as Partial<Creds>
    creds =
      parsed?.url && parsed?.serviceRoleKey && parsed.schemas?.config && parsed.schemas?.docs
        ? (parsed as Creds)
        : null
  } catch {
    creds = null
  }
  return creds
}

let client: SupabaseClient | null | undefined

/**
 * The one Supabase client, or null when credentials are missing or unreadable.
 *
 * Memoized and shared: the Specs widget and the layout-preset sync both need it,
 * and a second per-feature copy would mean two clients, two credential reads,
 * and two places for the "unavailable" path to drift.
 *
 * Read in the main process only; the service-role key is never handed to the
 * renderer, and every table read and write goes back over IPC.
 *
 * Never throws. Every caller degrades to its own empty/unavailable state.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client
  const c = readCreds()
  client = c ? createClient(c.url, c.serviceRoleKey) : null
  return client
}

/** The configured schema names, or null when credentials are unavailable. */
export function getSchemas(): Schemas | null {
  return readCreds()?.schemas ?? null
}
