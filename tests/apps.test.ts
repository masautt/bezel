import { describe, it, expect } from 'vitest'
import { groupApps, buildAppsView, matchesFilter, RECENT_LIMIT } from '@shared/apps'
import type { AppEntry } from '@shared/types'

const entry = (
  repo: string,
  group: string,
  extra: Partial<AppEntry> = {}
): AppEntry => ({
  org: 'sbrain-inc',
  repo,
  root: `C:/x/${repo}`,
  group,
  description: '',
  hasManifest: true,
  lastActivity: 0,
  ...extra,
})

describe('groupApps', () => {
  it('groups by group name, sorted alphabetically', () => {
    const result = groupApps([entry('finapp', 'apps'), entry('sbrain-scripts', 'tools'), entry('minapp', 'apps')])
    expect(result.map(g => g.label)).toEqual(['apps', 'tools'])
    expect(result[0].apps.map(a => a.repo)).toEqual(['finapp', 'minapp'])
  })

  it('sorts repos within a group even when the input is unsorted', () => {
    const result = groupApps([entry('minapp', 'apps'), entry('finapp', 'apps')])
    expect(result[0].apps.map(a => a.repo)).toEqual(['finapp', 'minapp'])
  })

  it('collects repos with no group under "ungrouped"', () => {
    const result = groupApps([entry('lapdog', '')])
    expect(result.map(g => g.label)).toEqual(['ungrouped'])
    expect(result[0].apps.map(a => a.repo)).toEqual(['lapdog'])
  })

  it('returns an empty array for no entries', () => {
    expect(groupApps([])).toEqual([])
  })
})

describe('matchesFilter', () => {
  const e = entry('sbrain-finapp-comp', 'finapp')

  it('matches on repo, org, and group, case-insensitively', () => {
    expect(matchesFilter(e, 'FINAPP')).toBe(true)
    expect(matchesFilter(e, 'sbrain-inc')).toBe(true)
    expect(matchesFilter(e, 'comp')).toBe(true)
  })

  it('treats blank and whitespace-only filters as no filter', () => {
    expect(matchesFilter(e, '')).toBe(true)
    expect(matchesFilter(e, '   ')).toBe(true)
  })

  it('rejects a non-match', () => {
    expect(matchesFilter(e, 'zzz')).toBe(false)
  })
})

describe('buildAppsView', () => {
  const withManifest = entry('finapp', 'apps')
  const noManifest = entry('some-repo', 'sbrain-inc', { hasManifest: false })

  it('apps view shows only repos declaring a manifest, and counts the rest as hidden', () => {
    const r = buildAppsView([withManifest, noManifest], { view: 'apps', filter: '', currentRoot: null })
    expect(r.sections.flatMap(s => s.apps.map(a => a.repo))).toEqual(['finapp'])
    expect(r.hidden).toBe(1)
  })

  it('orgs view shows every repo grouped by org, hiding nothing', () => {
    const r = buildAppsView([withManifest, noManifest], { view: 'orgs', filter: '', currentRoot: null })
    expect(r.sections.map(s => s.label)).toEqual(['sbrain-inc'])
    expect(r.sections[0].apps.map(a => a.repo)).toEqual(['finapp', 'some-repo'])
    expect(r.hidden).toBe(0)
  })

  it('recent view ranks by lastActivity, newest first', () => {
    const older = entry('older', 'g', { lastActivity: 100 })
    const fresh = entry('fresh', 'g', { lastActivity: 900 })
    const r = buildAppsView([older, fresh], { view: 'recent', filter: '', currentRoot: null })
    expect(r.sections[0].apps.map(a => a.repo)).toEqual(['fresh', 'older'])
  })

  it(`recent view caps at ${RECENT_LIMIT} and reports the remainder as hidden`, () => {
    const many = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) => entry(`r${i}`, 'g', { lastActivity: i }))
    const r = buildAppsView(many, { view: 'recent', filter: '', currentRoot: null })
    expect(r.sections[0].apps).toHaveLength(RECENT_LIMIT)
    expect(r.hidden).toBe(5)
  })

  it('a filter searches every repo even in apps view, where the manifest rule would hide it', () => {
    const r = buildAppsView([withManifest, noManifest], { view: 'apps', filter: 'some-repo', currentRoot: null })
    expect(r.sections.flatMap(s => s.apps.map(a => a.repo))).toEqual(['some-repo'])
    expect(r.hidden).toBe(0)
  })

  it('pins the current repo and excludes it from the sections so it is not listed twice', () => {
    const r = buildAppsView([withManifest, noManifest], {
      view: 'orgs',
      filter: '',
      currentRoot: withManifest.root,
    })
    expect(r.current?.repo).toBe('finapp')
    expect(r.sections.flatMap(s => s.apps.map(a => a.repo))).toEqual(['some-repo'])
  })

  it('pins the current repo even when the active view would otherwise exclude it', () => {
    const r = buildAppsView([withManifest, noManifest], {
      view: 'apps',
      filter: '',
      currentRoot: noManifest.root,
    })
    expect(r.current?.repo).toBe('some-repo')
  })

  it('reports no current repo when the context is outside every known repo', () => {
    const r = buildAppsView([withManifest], { view: 'apps', filter: '', currentRoot: 'C:/elsewhere' })
    expect(r.current).toBeNull()
  })
})
