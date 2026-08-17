import { describe, it, expect } from 'vitest'
import { mapSpecRow } from '@shared/specs'
import { specsViewState } from '../client/src/widgets/SpecsWidget'
import type { SpecItem } from '@shared/types'

describe('mapSpecRow', () => {
  // The date prefix AND the kind suffix both come off: every filename carries
  // both by convention, so leaving either in the title means every row in the
  // widget shares it and it distinguishes nothing.
  it('derives a human title from the filename, without the date or the kind', () => {
    const item = mapSpecRow({
      filename: '2026-07-31-bezel-design.md',
      file_path: 'repos/bezel/2026-07-31-bezel-design.md',
      status: 'design',
      tldr: ['a', 'b'],
    })
    expect(item.title).toBe('bezel')
    expect(item.kind).toBe('design')
    expect(item.filename).toBe('2026-07-31-bezel-design.md')
  })

  it('reads the plan kind off the suffix too', () => {
    const item = mapSpecRow({
      filename: '2026-01-02-thing-plan.md',
      file_path: 'repos/x/2026-01-02-thing-plan.md',
      status: null,
      tldr: null,
    })
    expect(item.title).toBe('thing')
    expect(item.kind).toBe('plan')
  })

  // The suffix is a convention, not a guarantee — a file that does not follow it
  // keeps its whole name and simply gets no glyph.
  it('leaves a filename with no kind suffix intact and reports no kind', () => {
    const item = mapSpecRow({
      filename: '2026-01-02-loose-notes.md',
      file_path: 'repos/x/2026-01-02-loose-notes.md',
      status: null,
      tldr: null,
    })
    expect(item.title).toBe('loose notes')
    expect(item.kind).toBeNull()
  })

  it('points at the generated html sibling', () => {
    const item = mapSpecRow({
      filename: '2026-07-31-bezel-design.md',
      file_path: 'repos/bezel/2026-07-31-bezel-design.md',
      status: 'design',
      tldr: [],
    })
    expect(item.htmlPath).toBe('repos/bezel/2026-07-31-bezel-design.html')
  })

  it('defaults a missing status and tldr', () => {
    const item = mapSpecRow({
      filename: '2026-01-02-thing-plan.md',
      file_path: 'repos/x/2026-01-02-thing-plan.md',
      status: null,
      tldr: null,
    })
    expect(item.status).toBe('unknown')
    expect(item.tldr).toEqual([])
  })

  it('leaves an undated filename intact in the title', () => {
    const item = mapSpecRow({ filename: 'notes.md', file_path: 'repos/x/notes.md', status: null, tldr: null })
    expect(item.title).toBe('notes')
  })
})

describe('specsViewState', () => {
  const SPEC: SpecItem = {
    filename: 'a.md', title: 'a', kind: null, status: 'design', tldr: [], htmlPath: 'a.html',
  }

  it('yields no-project when org or project is missing', () => {
    expect(specsViewState(null, 'bezel', undefined)).toEqual({ kind: 'no-project' })
    expect(specsViewState('devkit-inc', null, undefined)).toEqual({ kind: 'no-project' })
  })

  // The exact case the review flagged: org and project both resolved (the
  // common case — a restored project at mount) but the fetch has not
  // resolved yet. Must be 'loading', never 'empty' — this is what a boolean
  // `loading` flag seeded to `false` alongside `items` seeded to `[]` gets
  // wrong on the very first render.
  it('yields loading when org and project are set but items have not been fetched yet', () => {
    expect(specsViewState('devkit-inc', 'bezel', undefined)).toEqual({ kind: 'loading' })
  })

  it('yields unavailable when the fetch resolved null', () => {
    expect(specsViewState('devkit-inc', 'bezel', null)).toEqual({ kind: 'unavailable' })
  })

  it('yields empty when the fetch resolved an empty list', () => {
    expect(specsViewState('devkit-inc', 'bezel', [])).toEqual({ kind: 'empty' })
  })

  it('yields list with the items when the fetch resolved a populated list', () => {
    expect(specsViewState('devkit-inc', 'bezel', [SPEC])).toEqual({ kind: 'list', items: [SPEC] })
  })
})
