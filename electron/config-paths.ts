import { homedir } from 'os'
import { join } from 'path'

/**
 * Where bezel looks for the two files that describe a particular deployment:
 * Supabase credentials, and the org -> specs-repo registry.
 *
 * Both used to be resolved inside the orgs root, at a path naming a specific
 * private org. That was wrong twice over. Practically, the location of a
 * credentials file has nothing to do with where repos happen to be checked out,
 * so the coupling only made bezel reach sideways into a sibling org's
 * directory. And because this repo is published, a hardcoded path also
 * advertised where a service-role key lives on disk — no key was ever exposed,
 * but a public map to one is not worth the convenience.
 *
 * So: a conventional per-user config directory, overridable by environment
 * variable, and nothing deployment-specific compiled in. Anything site-specific
 * — including the database schema names — comes out of the files themselves,
 * which live outside the repo.
 *
 * Resolved per call rather than at module load so a test (or a relaunch under a
 * different environment) can change them without a fresh module registry.
 */
const configDir = () => process.env.BEZEL_CONFIG_DIR || join(homedir(), '.config', 'bezel')

/** Supabase url, service-role key, and the schema names to address. */
export const supabaseCredsPath = () => process.env.BEZEL_SUPABASE_CREDS || join(configDir(), 'supabase.json')

/** The org -> specs-repo mapping the Specs widget resolves local paths against. */
export const specsRegistryPath = () => process.env.BEZEL_SPECS_REGISTRY || join(configDir(), 'specs-repos.json')
