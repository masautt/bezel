import { useProjectContext } from '../ContextProvider'
import { useGitInfo } from '../useGitInfo'
import { Widget } from './Widget'

const LIMIT = 12

export function ChangesWidget() {
  const { context } = useProjectContext()
  const git = useGitInfo(context.root)

  // Nothing to list, so nothing to draw. The gutter drops the empty slot and its
  // grab handle (`.slot:empty` in styles.css), which is what makes this a widget
  // that appears when work starts rather than a permanent box reading "clean".
  // The absence IS the signal: no Changes card means no changes.
  if (!context.root) return null
  if (git !== undefined && git !== null && git.dirty.length === 0) return null
  // "clean" is a positive claim about the repo, so it must not be what we say
  // while the status call is in flight or after it failed — both of those still
  // render, because neither one means the repo is clean.
  if (git === undefined) return <Widget title="Changes"><div className="row muted">reading…</div></Widget>
  if (git === null) return <Widget title="Changes"><div className="row muted">unavailable</div></Widget>

  const shown = git.dirty.slice(0, LIMIT)
  const rest = git.dirty.length - shown.length

  return (
    <Widget title="Changes">
      {shown.map(entry => <div className="row" key={entry}>{entry}</div>)}
      {rest > 0 && <div className="row muted">+{rest} more</div>}
    </Widget>
  )
}
