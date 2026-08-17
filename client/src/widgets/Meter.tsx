import type { Severity } from '@shared/usage'

export interface MeterProps {
  /** Left of the bar. Short: the gutter is 240px by default. */
  label: string
  percent: number
  severity: Severity
  /** Right of the label, muted — the number behind the bar (a token count, a
   *  reset countdown). Optional because not every meter has a second fact. */
  note?: string | null
}

/**
 * One labelled bar. The whole visual vocabulary of both gauge widgets lives
 * here, so a bar means the same thing wherever it appears — including its
 * colour, which is driven off `data-severity` in CSS rather than an inline
 * style, so themes can restate it.
 *
 * `role="meter"` rather than `progressbar`: this is a filled-ness reading with
 * a known maximum, not a task advancing toward completion. Screen readers
 * announce the percentage from the ARIA values, which is why the visible
 * percentage is `aria-hidden` — otherwise it is read twice.
 */
export function Meter({ label, percent, severity, note }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="meter" data-severity={severity}>
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        {note && <span className="meter-note">{note}</span>}
        <span className="meter-pct" aria-hidden="true">{clamped}%</span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${clamped}%${note ? `, ${note}` : ''}`}
      >
        <div className="meter-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
