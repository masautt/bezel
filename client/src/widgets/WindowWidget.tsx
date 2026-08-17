import { formatLimit, formatTokens, shortModel } from '@shared/context-meter'
import { useProjectContext } from '../ContextProvider'
import { useContextMeter } from '../useClaudeState'
import { Meter } from './Meter'
import { Widget } from './Widget'

/**
 * How full the claude pane's context window is.
 *
 * Sourced from the session's transcript rather than the pane (a pty is a
 * terminal, not an API) — see electron/context-service.ts. That makes the
 * reading authoritative but not continuous: it advances one step per assistant
 * turn, so the timestamp is shown whenever it has gone quiet rather than
 * letting a bar frozen mid-run pass for a live one.
 */
export function WindowWidget() {
  const { context, sessionId } = useProjectContext()
  // The live cwd, NOT the sticky repo root: a pinned context still describes
  // some earlier repo, while the session whose window this is runs where the
  // pane actually is.
  const meter = useContextMeter(context.cwd, sessionId)

  if (meter === undefined) {
    return <Widget title="Window"><div className="row muted">reading…</div></Widget>
  }
  // Not "0%": no transcript for this directory means no session to measure, and
  // an empty bar is a claim about a window that does not exist.
  if (meter === null) {
    return <Widget title="Window"><div className="row muted">no session here</div></Widget>
  }

  const model = shortModel(meter.model)
  const age = meter.at ? Date.now() - Date.parse(meter.at) : NaN
  // Two minutes: longer than any single turn's think time, so a session mid-run
  // is never labelled stale, and short enough to catch a pane left idle.
  const stale = Number.isFinite(age) && age > 120_000

  return (
    <Widget title="Window">
      <Meter
        label={`${formatTokens(meter.tokens)} / ${formatLimit(meter.limit)}`}
        percent={meter.percent}
        severity={meter.severity}
      />
      <div className="row muted">
        {model ?? 'unknown model'}
        {stale && <span data-testid="window-stale"> · idle</span>}
      </div>
    </Widget>
  )
}
