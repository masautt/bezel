import type { SpecItem, SpecKind } from './types.js'

export interface SpecRow {
  filename: string
  file_path: string
  status: string | null
  tldr: string[] | null
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/
/** The devkit filename convention: every spec ends `-design` or `-plan`. */
const KIND_SUFFIX = /-(design|plan)$/

// Pure mapper, browser-safe: no Node builtins. The Supabase query that
// produces SpecRow[] lives in electron/specs-service.ts, not here.
export function mapSpecRow(row: SpecRow): SpecItem {
  const bare = row.filename.replace(/\.md$/, '')
  // The kind comes OUT of the title rather than being left on the end of it.
  // Every filename carries it by convention, so leaving it in place made the
  // widget a column of rows all ending in the same two words — and the `status`
  // chip beside them frequently repeated it a third time. Rendered as a glyph
  // at the head of the row instead (see SpecsWidget), where it distinguishes
  // rows at a glance without costing any of the width the actual title needs.
  const kind = (KIND_SUFFIX.exec(bare)?.[1] ?? null) as SpecKind | null
  const title = bare
    .replace(DATE_PREFIX, '')
    .replace(KIND_SUFFIX, '')
    .replace(/-/g, ' ')
  return {
    filename: row.filename,
    title,
    kind,
    status: row.status ?? 'unknown',
    tldr: row.tldr ?? [],
    htmlPath: row.file_path.replace(/\.md$/, '.html'),
  }
}
