// GitHub URLs derived from a package's `repository` field. Zero imports, like
// tabs.ts and keys.ts: compiled by all four tsconfig projects, so no DOM or
// Node types. The values it works on are injected at build time by
// vite.config.mts, which reads them out of node_modules.

/** `owner/repo` from any of the forms npm stores, or null. */
function githubSlug(repository: string | undefined): string | null {
  if (!repository) return null
  // npm writes `git+https://github.com/owner/repo.git`; humans write the plain
  // https form; and older manifests carry `git@github.com:owner/repo.git`.
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repository.trim())
  if (!match) return null
  return `${match[1]}/${match[2]}`
}

/**
 * The repo's releases page.
 *
 * Deliberately the LIST rather than a tag: the internal packages are published
 * to GitHub Packages but not tagged for every published version — bezel depends
 * on electron-ui 2.6.0, whose repo jumps from v2.2.0 to v2.7.0, and on react-ui
 * 1.21.0, which has no releases at all. A per-version link would be a 404 for
 * both. The list always resolves and is one click from whatever you wanted.
 *
 * null when the repository field is missing or is not a GitHub URL, which the
 * caller renders as plain text — no link beats a link that goes somewhere
 * wrong, in the one panel people open when something is already confusing.
 */
export function releasesUrl(repository: string | undefined): string | null {
  const slug = githubSlug(repository)
  return slug ? `https://github.com/${slug}/releases` : null
}

/**
 * A specific version's release page. Used for bezel itself, which does tag
 * every release, unlike the packages above.
 */
export function releaseTagUrl(repository: string | undefined, version: string): string | null {
  const slug = githubSlug(repository)
  if (!slug || !version) return null
  const tag = version.startsWith('v') ? version : `v${version}`
  return `https://github.com/${slug}/releases/tag/${tag}`
}
