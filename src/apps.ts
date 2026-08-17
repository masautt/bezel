import type { AppEntry, AppsView } from './types.js'

// Pure grouping helpers. Browser-safe: no Node builtins. The filesystem scan
// that produces AppEntry[] lives in electron/apps-service.ts, not here.

export interface AppSection {
  label: string
  apps: AppEntry[]
}

export interface AppsViewResult {
  /** The repo the terminals are currently in, pinned above every section. */
  current: AppEntry | null
  sections: AppSection[]
  /** Entries the active view hides but a different view (or a filter) would
   *  reveal. Rendered as a hint so the list never lies by omission. */
  hidden: number
}

function sectionsBy(entries: AppEntry[], key: (e: AppEntry) => string): AppSection[] {
  const byKey = new Map<string, AppEntry[]>()
  for (const e of entries) {
    const k = key(e)
    const list = byKey.get(k) ?? []
    list.push(e)
    byKey.set(k, list)
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, apps]) => ({ label, apps: [...apps].sort((a, b) => a.repo.localeCompare(b.repo)) }))
}

export function groupApps(entries: AppEntry[]): AppSection[] {
  return sectionsBy(entries, e => e.group || 'ungrouped')
}

export function matchesFilter(entry: AppEntry, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  return (
    entry.repo.toLowerCase().includes(q) ||
    entry.org.toLowerCase().includes(q) ||
    entry.group.toLowerCase().includes(q)
  )
}

/** How many repos the `recent` view shows before it stops. */
export const RECENT_LIMIT = 12

// A filter always searches EVERY entry, regardless of view — otherwise typing a
// repo name in `apps` mode would silently fail to find the 109 repos that have
// no manifest, which is exactly the confusion this widget exists to remove.
export function buildAppsView(
  entries: AppEntry[],
  opts: { view: AppsView; filter: string; currentRoot: string | null }
): AppsViewResult {
  const { view, filter, currentRoot } = opts
  const current = entries.find(e => e.root === currentRoot) ?? null
  // The current repo is rendered pinned above the sections, so exclude it from
  // them — otherwise it appears twice and the duplicate reads as a bug.
  const matched = entries.filter(e => e.root !== current?.root && matchesFilter(e, filter))

  if (filter.trim() !== '') {
    return { current, sections: sectionsBy(matched, e => e.org), hidden: 0 }
  }

  if (view === 'orgs') {
    return { current, sections: sectionsBy(matched, e => e.org), hidden: 0 }
  }

  if (view === 'recent') {
    const ranked = [...matched].sort((a, b) => b.lastActivity - a.lastActivity)
    const shown = ranked.slice(0, RECENT_LIMIT)
    return {
      current,
      sections: shown.length ? [{ label: 'recent', apps: shown }] : [],
      hidden: ranked.length - shown.length,
    }
  }

  // 'apps': only repos declaring a manifest are real apps. The rest merely live
  // under an org, and they drown the list — 109 of 139 on this machine.
  const apps = matched.filter(e => e.hasManifest)
  return {
    current,
    sections: sectionsBy(apps, e => e.group || 'ungrouped'),
    hidden: matched.length - apps.length,
  }
}
