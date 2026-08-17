import { useEffect, useState } from 'react'
import type { SpecItem, SpecKind } from '@shared/types'
import { useProjectContext } from '../ContextProvider'
import { Widget } from './Widget'

/** One glyph per document kind, replacing the word the filename used to leave on
 *  the end of every title. A palette for the thing that decides what to build, a
 *  clipboard for the thing that lists how. */
const KIND_GLYPH: Record<SpecKind, string> = {
  design: '🎨',
  plan: '📋',
}

export type SpecsViewState =
  | { kind: 'no-project' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'list'; items: SpecItem[] }

// Pure decision function, deliberately kept outside the component and its
// effect timing so it can be unit-tested without rendering or async flushing.
//
// `items` carries three states, not two: `undefined` = not fetched yet,
// `null` = unavailable (no credentials, offline, query error), `[]` = the
// project genuinely has no specs. Collapsing "not fetched yet" into `[]`
// (e.g. via a separate `loading` boolean seeded to `false`) makes "empty"
// the state shown on the very first render whenever org/project are already
// resolved at mount — a real "none" flash before the list appears. Carrying
// "not fetched" in the type instead makes that flash impossible by
// construction: there is no reachable branch order that yields 'empty'
// before a fetch has resolved.
export function specsViewState(
  org: string | null,
  project: string | null,
  items: SpecItem[] | null | undefined
): SpecsViewState {
  if (!org || !project) return { kind: 'no-project' }
  if (items === undefined) return { kind: 'loading' }
  if (items === null) return { kind: 'unavailable' }
  if (items.length === 0) return { kind: 'empty' }
  return { kind: 'list', items }
}

export function SpecsWidget() {
  const { context } = useProjectContext()
  const [items, setItems] = useState<SpecItem[] | null | undefined>(undefined)

  const org = context.org
  // The `project` key in sbrain_docs.specs is the last path segment of the
  // repo — `sbrain/sbrain-scripts` is stored as `sbrain-scripts`.
  const project = context.repo?.split('/').pop() ?? null

  useEffect(() => {
    if (!org || !project) { setItems(undefined); return }
    let alive = true
    setItems(undefined)
    void window.bezel.specs.list(org, project).then(next => {
      if (!alive) return
      setItems(next)
    })
    return () => { alive = false }
  }, [org, project])

  const state = specsViewState(org, project, items)

  switch (state.kind) {
    // Both of these are "there is nothing here", and a widget whose entire
    // content is a word saying so is a row of gutter height spent on nothing.
    // The gutter drops the slot and its grabber with it (`.slot:empty` in
    // styles.css), so Specs simply is not there until a project has one.
    // 'loading' and 'unavailable' deliberately still render: the first is a
    // half-second of honesty about a list that is coming, and the second is the
    // difference between "this project has no specs" and "I could not ask".
    case 'no-project':
    case 'empty':
      return null
    case 'loading': return <Widget title="Specs"><div className="row muted">loading…</div></Widget>
    case 'unavailable': return <Widget title="Specs"><div className="row muted">unavailable</div></Widget>
    case 'list':
      return (
        <Widget title="Specs">
          {state.items.map(item => (
            <button
              key={item.filename}
              type="button"
              className="row app-row"
              title={item.tldr.join('\n')}
              onClick={() => void window.bezel.specs.open(org!, item.htmlPath)}
            >
              {/* Leads the row rather than trailing it: the glyph is the fastest
                  thing to scan down a column, and it is fixed-width, so the
                  titles beside it stay on one x. aria-hidden with the word in a
                  sibling — an emoji's announced name ("artist palette") is not
                  what this means. */}
              {item.kind && (
                <>
                  <span aria-hidden="true">{KIND_GLYPH[item.kind]}</span>
                  <span className="sr-only">{item.kind}</span>{' '}
                </>
              )}
              {item.title}
              {/* Dropped when it would only repeat the glyph — `status` is
                  frequently the same word as the kind. */}
              {item.status !== item.kind && <span className="muted"> · {item.status}</span>}
            </button>
          ))}
        </Widget>
      )
  }
}
