import { readFileSync } from 'fs'
// A relative import, not the `@shared` alias: tsc does not rewrite path-mapped
// specifiers in its output, so a runtime (non-type-only) import through the
// alias would resolve to a nonexistent "@shared" package once compiled.
import { getSupabase } from './supabase.js'
import { mapSpecRow } from '../src/specs.js'
import type { SpecRow } from '../src/specs.js'
import type { SpecItem } from '@shared/types.js'

/** Where a spec ended up, so callers (and tests) can see which path was taken. */
export type SpecTarget =
  | { kind: 'local'; path: string }
  | { kind: 'remote'; url: string }

/**
 * Pure target resolution, so the local-vs-remote and .html-vs-.md decisions are
 * testable without a filesystem or a browser.
 *
 * Prefers the generated `.html` on disk: GitHub's blob view renders Markdown but
 * shows HTML as SOURCE, so the old `blob/main/….html` link opened a wall of
 * escaped markup. The local file opens in the default browser and actually
 * renders — no network, no auth prompt on a private repo, and it reflects a
 * `convert-to-html.mjs` run immediately rather than after a push.
 *
 * The remote fallback points at the `.md`, not the `.html`, for that same reason:
 * Markdown is the form GitHub renders. Either way the user gets a document.
 *
 * `registry` is `sbrain-inc/.config/specs-repos.json` — the same org -> specs-repo
 * mapping the devkit-specs write hook resolves against. Read rather than derived
 * because the convention is not uniform: devkit-specs sits at
 * `orgs/devkit-inc/devkit-specs`, but sbrain-specs nests at
 * `orgs/sbrain-inc/sbrain/sbrain-specs`, and a naming rule would miss it.
 */
export function resolveSpecTarget(
  org: string,
  htmlPath: string,
  registry: Array<{ root: string; org: string }> | null,
  exists: (p: string) => boolean
): SpecTarget {
  const entry = registry?.find(r => r.org === org)
  if (entry) {
    const local = `${entry.root.replace(/\\/g, '/').replace(/\/+$/, '')}/${htmlPath}`
    if (exists(local)) return { kind: 'local', path: local }
  }
  // Repo not cloned here, or not in the registry: fall back to the rendered form.
  const repo = `${org.replace(/-inc$/, '')}-specs`
  const mdPath = htmlPath.replace(/\.html$/, '.md')
  return { kind: 'remote', url: `https://github.com/${org}/${repo}/blob/main/${mdPath}` }
}

/** The registry, or null when it is absent/unreadable — never a throw. */
export function readSpecsRegistry(orgsRoot: string): Array<{ root: string; org: string }> | null {
  try {
    const raw = readFileSync(`${orgsRoot}/sbrain-inc/.config/specs-repos.json`, 'utf-8')
    const parsed = JSON.parse(raw) as Array<{ root: string; org: string }>
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Returns null when specs are unavailable (no credentials, offline, query
// error). That is deliberately distinct from [] — "no specs for this project".
export async function listSpecs(orgsRoot: string, org: string, project: string): Promise<SpecItem[] | null> {
  const supabase = getSupabase(orgsRoot)
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .schema('sbrain_docs')
      .from('specs')
      .select('filename, file_path, status, tldr')
      .eq('org', org)
      .eq('project', project)
      .order('filename', { ascending: false })
    if (error) return null
    return (data as SpecRow[]).map(mapSpecRow)
  } catch {
    return null
  }
}
