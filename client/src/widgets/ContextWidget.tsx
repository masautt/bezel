import { abbreviateHome, normalizePath } from '@shared/paths'
import { useProjectContext } from '../ContextProvider'
import { useGitInfo } from '../useGitInfo'
import { Widget } from './Widget'

/**
 * Where you are: org, repo, branch, and the cwd when it differs from the root.
 *
 * Read-only. There used to be a "switch" button here opening a repo picker that
 * could re-point the widgets or move the terminals; it is gone, along with the
 * picker. The shell pane is the way to change repos — `cd` reports OSC 7 on the
 * next prompt and every widget in both gutters follows it — so the button was a
 * second mechanism for something the terminal already does, sitting in the
 * header of the widget whose whole job is to report the answer rather than
 * change it.
 */
export function ContextWidget() {
  // Inside the component, not at module scope — see the note in ContextProvider.
  const HOME = window.bezel.roots.home
  const { context } = useProjectContext()
  const git = useGitInfo(context.root)

  if (!context.org) {
    return (
      <Widget title="Context">
        <div className="row muted">{abbreviateHome(context.cwd, HOME)}</div>
      </Widget>
    )
  }

  // Suppressed at the repo root, where it would only restate the rows above it.
  const showCwd = normalizePath(context.cwd) !== context.root

  return (
    <Widget title="Context">
      <div className="row current">
        {context.org}
        {/* The pin describes the three rows above the cwd, so the marker
            belongs here rather than on the cwd row — which is the one thing
            still literally true while pinned. */}
        {context.pinned && <span className="muted"> · pinned</span>}
      </div>
      <div className="row">{context.repo ?? '—'}</div>
      <div className="row muted">
        {git?.branch ?? 'no branch'}
        {git && git.ahead > 0 ? ` · ${git.ahead} ahead` : ''}
        {git && git.dirty.length > 0 ? ` · ${git.dirty.length} dirty` : ''}
      </div>
      {showCwd && (
        <div className="row muted context-cwd" data-testid="context-cwd" title={context.cwd}>
          {abbreviateHome(context.cwd, HOME)}
        </div>
      )}
    </Widget>
  )
}
