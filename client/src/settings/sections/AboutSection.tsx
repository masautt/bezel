import { releasesUrl, releaseTagUrl } from '@shared/repo-url'

/**
 * A version that opens its GitHub page, or plain text when there is nothing to
 * open.
 *
 * A BUTTON, deliberately, not an anchor. A real navigation in this renderer
 * fires `did-start-navigation`, which main wires to `killAll` — so an ordinary
 * link in the settings panel would kill every pty in every tab. Everything
 * outward goes through `openExternal`, which hands the URL to the OS browser.
 */
function VersionLink({ version, href }: { version: string; href: string | null }) {
  if (!href) return <span className="settings-about-value">{version}</span>
  return (
    <button
      type="button"
      className="settings-about-value settings-about-link"
      onClick={() => { void window.bezel.openExternal(href) }}
      title={href}
    >
      {version}
    </button>
  )
}

/**
 * Read-only facts worth having when a layout or a pin looks wrong. Cheap to
 * render and the first place to look when bezel is resolving paths oddly on a
 * machine — which is exactly the class of bug the roots derivation exists for.
 *
 * The versions come from `__APP_VERSION__` / `__INTERNAL_DEPS__`, injected by
 * vite.config.mts at build time from package.json and node_modules. The
 * internal packages report their RESOLVED versions rather than the ranges in
 * package.json: the range describes what an install would accept, and the
 * question this panel answers is which build is running right now.
 */
export function AboutSection({ version }: { version: string }) {
  const roots = window.bezel.roots
  const deps = typeof __INTERNAL_DEPS__ === 'undefined' ? [] : __INTERNAL_DEPS__
  const appRepo = typeof __APP_REPOSITORY__ === 'undefined' ? undefined : __APP_REPOSITORY__

  const paths: Array<[string, string]> = [
    ['Home', roots.home],
    ['Source root', roots.sourceRoot],
    ['Orgs root', roots.orgsRoot],
  ]

  return (
    <div className="settings-section">
      <div className="settings-row">
        <span className="settings-about-label">Version</span>
        {/* bezel tags every release, so this one can point at the exact tag. */}
        <VersionLink version={version} href={releaseTagUrl(appRepo, version)} />
      </div>

      {deps.map(dep => (
        <div className="settings-row" key={dep.name}>
          <span className="settings-about-label" title={dep.name}>{dep.name}</span>
          {/* The releases LIST, not a tag: these packages are published to
              GitHub Packages without a tag for every version, so a per-version
              link would be a 404. */}
          <VersionLink version={dep.version} href={releasesUrl(dep.repository)} />
        </div>
      ))}

      {paths.map(([label, value]) => (
        <div className="settings-row" key={label}>
          <span className="settings-about-label">{label}</span>
          <span className="settings-about-value" title={value}>{value}</span>
        </div>
      ))}
    </div>
  )
}
