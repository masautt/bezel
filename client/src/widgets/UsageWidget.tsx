import { formatMoney, formatResetIn } from '@shared/usage'
import type { UsageWindow } from '@shared/usage'
import { useUsage } from '../useClaudeState'
import { Meter } from './Meter'
import { Widget } from './Widget'

/**
 * Both plan limits at once: the rolling five-hour window and the seven-day one.
 *
 * Two bars rather than one worst-of, because they fail differently — a full
 * five-hour window costs a coffee break, a full week costs the week — and which
 * one you are near changes what you do next.
 *
 * These are the account's REAL percentages, read from the same endpoint Claude
 * Code's own /usage reads (electron/usage-service.ts), not a local estimate
 * counted off transcripts.
 */
export function UsageWidget() {
  const usage = useUsage()

  if (usage === undefined) {
    return <Widget title="Usage"><div className="row muted">reading…</div></Widget>
  }
  // No stored credential (or a Keychain platform, or offline). Never a zeroed
  // bar: "you have used none of your limit" is the most misleading thing this
  // widget could say while knowing nothing.
  if (usage === null) {
    return <Widget title="Usage"><div className="row muted">unavailable</div></Widget>
  }

  const now = Date.now()
  const bar = (label: string, w: UsageWindow | null) => {
    if (!w) return null
    const resets = formatResetIn(w.resetsAt, now)
    return <Meter label={label} percent={w.percent} severity={w.severity} note={resets ? `${resets} left` : null} />
  }

  return (
    <Widget title="Usage">
      {bar('session · 5h', usage.session)}
      {bar('weekly · 7d', usage.weekly)}
      {usage.extra && (
        <div className="row muted">
          credits {formatMoney(usage.extra.usedMinor, usage.extra.exponent, usage.extra.currency)}
          {' / '}
          {formatMoney(usage.extra.limitMinor, usage.extra.exponent, usage.extra.currency)}
        </div>
      )}
    </Widget>
  )
}
