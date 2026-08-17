import { describe, it, expect } from 'vitest'
import { resolveSpecTarget } from '../electron/specs-service.js'

const REGISTRY = [
  { root: 'C:/Users/testuser/source/orgs/devkit-inc/devkit-specs', org: 'devkit-inc' },
  // Nested one level deeper than the flat convention — this entry is why the
  // registry is read instead of the repo name being derived from the org.
  { root: 'C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-specs', org: 'sbrain-inc' },
]
const HTML = 'repos/bezel/2026-08-08-bezel-tweaks-design.html'
const all = () => true
const none = () => false

describe('resolveSpecTarget', () => {
  it('prefers the generated .html on disk', () => {
    expect(resolveSpecTarget('devkit-inc', HTML, REGISTRY, all)).toEqual({
      kind: 'local',
      path: `C:/Users/testuser/source/orgs/devkit-inc/devkit-specs/${HTML}`,
    })
  })

  // The naming convention (`<org minus -inc>-specs` directly under the org) does
  // not hold for sbrain, whose specs repo nests under a container repo.
  it('resolves a nested specs repo from the registry, not from the org name', () => {
    const t = resolveSpecTarget('sbrain-inc', HTML, REGISTRY, all)
    expect(t).toEqual({
      kind: 'local',
      path: `C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-specs/${HTML}`,
    })
  })

  // GitHub renders Markdown but shows HTML as SOURCE, so the remote fallback must
  // NOT point at the .html — that is the bug this tweak exists to remove.
  it('falls back to the .md on GitHub, never the .html', () => {
    const t = resolveSpecTarget('devkit-inc', HTML, REGISTRY, none)
    expect(t).toEqual({
      kind: 'remote',
      url: 'https://github.com/devkit-inc/devkit-specs/blob/main/repos/bezel/2026-08-08-bezel-tweaks-design.md',
    })
    expect(t.kind === 'remote' && t.url.endsWith('.html')).toBe(false)
  })

  it('falls back when the org is absent from the registry', () => {
    expect(resolveSpecTarget('teamx-inc', HTML, REGISTRY, all)).toEqual({
      kind: 'remote',
      url: 'https://github.com/teamx-inc/teamx-specs/blob/main/repos/bezel/2026-08-08-bezel-tweaks-design.md',
    })
  })

  // readSpecsRegistry returns null when the file is missing or unreadable; that
  // must degrade to the remote link, not throw on a click.
  it('falls back when there is no registry at all', () => {
    expect(resolveSpecTarget('devkit-inc', HTML, null, all).kind).toBe('remote')
  })

  it('tolerates a registry root with backslashes or a trailing slash', () => {
    const reg = [{ root: 'C:\\Users\\testuser\\source\\orgs\\devkit-inc\\devkit-specs\\', org: 'devkit-inc' }]
    expect(resolveSpecTarget('devkit-inc', HTML, reg, all)).toEqual({
      kind: 'local',
      path: `C:/Users/testuser/source/orgs/devkit-inc/devkit-specs/${HTML}`,
    })
  })
})
