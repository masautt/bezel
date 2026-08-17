import { Widget } from './Widget'

export interface SessionWidgetProps {
  /** The active tab's summaries, newest first. */
  history: string[]
}

/**
 * What this session has worked on. Claude Code reports a short summary of its
 * current task as the terminal title; the tab strip shows only the newest one,
 * truncated. This is the rest of them.
 *
 * Purely presentational — unlike its gutter siblings it takes a prop rather
 * than reading useProjectContext(), because its data is per-tab rather than
 * per-directory.
 */
export function SessionWidget({ history }: SessionWidgetProps) {
  if (history.length === 0) {
    return <Widget title="Session"><div className="row muted">nothing yet</div></Widget>
  }

  // Newest first, so [0] is what the session is doing now and the rest is where
  // it has been. Split here rather than styling off `:first-child` so the two
  // registers can be different STRUCTURE — a headline and a labelled list — not
  // just the same row at two sizes.
  const [current, ...past] = history

  return (
    <Widget title="Session">
      <div className="session-list">
        <div data-testid="session-entry" className="row session-entry current">
          {current}
        </div>
        {past.length > 0 && (
          <div className="session-past">
            {/* Says what the demoted rows ARE. Without it the smaller type below
                the headline reads as detail belonging to it rather than as
                superseded work. */}
            <div className="session-past-label">earlier this session</div>
            {past.map((entry, index) => (
              // The index is part of the key on purpose: the same summary can
              // legitimately appear twice (claude returning to an earlier task),
              // so the text alone is not unique.
              <div
                key={`${index}-${entry}`}
                data-testid="session-entry"
                className="row session-entry past"
              >
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>
    </Widget>
  )
}
