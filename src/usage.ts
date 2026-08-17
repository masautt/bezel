// Plan-limit usage, as plain data. Browser-safe: no Node builtins, no fetch —
// the HTTP call and the OAuth token that authorizes it live in
// electron/usage-service.ts and never cross the bridge. This file only shapes
// what came back and formats it, so both halves can be tested without a network.

/** Shared by both meters: how alarming a percentage is. */
export type Severity = 'normal' | 'warn' | 'critical'

export interface UsageWindow {
  /** 0..100. Whole percent — the API reports whole percent too. */
  percent: number
  /** ISO 8601, or null when this window has no scheduled reset. */
  resetsAt: string | null
  severity: Severity
}

export interface ExtraUsage {
  /** Minor units (cents), so no float ever holds money. */
  usedMinor: number
  limitMinor: number
  currency: string
  exponent: number
}

export interface UsageSnapshot {
  /** The rolling window — five hours on every current plan. */
  session: UsageWindow | null
  /** The seven-day window, across all models. */
  weekly: UsageWindow | null
  /** Pay-as-you-go credits, when the account has them switched on. */
  extra: ExtraUsage | null
  /** When this was read, ISO. Lets the widget say how stale it is. */
  fetchedAt: string
}

/** 70/90 rather than 80/95: at 90% of a seven-day window there is nothing left
 *  to do about it, so the amber has to arrive early enough to change plans. */
export const WARN_AT = 70
export const CRITICAL_AT = 90

export function severityOf(percent: number): Severity {
  if (percent >= CRITICAL_AT) return 'critical'
  if (percent >= WARN_AT) return 'warn'
  return 'normal'
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function iso(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * One window from either of the two shapes the endpoint answers with.
 *
 * `limits[]` is the newer, general form (kind/percent/severity/resets_at) and
 * the named `five_hour`/`seven_day` objects are the older one. Both are present
 * today, which is exactly the situation in which to prefer one and keep the
 * other as a fallback rather than picking now and breaking later: whichever the
 * account is served, a window comes back.
 */
function windowFrom(raw: unknown): UsageWindow | null {
  if (!isRecord(raw)) return null
  const percent = num(raw.percent) ?? num(raw.utilization)
  if (percent === null) return null
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const reported = raw.severity
  return {
    percent: clamped,
    resetsAt: iso(raw.resets_at),
    // The server's own severity wins when it sends one: it knows about states
    // this client does not (a soft cap, a promotional allowance) and a locally
    // derived colour would contradict it.
    severity:
      reported === 'normal' || reported === 'warn' || reported === 'critical'
        ? reported
        : severityOf(clamped),
  }
}

function extraFrom(raw: unknown): ExtraUsage | null {
  if (!isRecord(raw)) return null
  const spend = isRecord(raw.spend) ? raw.spend : null
  const used = isRecord(spend?.used) ? spend.used : null
  const limit = isRecord(spend?.limit) ? spend.limit : null
  const usedMinor = num(used?.amount_minor)
  const limitMinor = num(limit?.amount_minor)
  if (usedMinor === null || limitMinor === null || limitMinor <= 0) return null
  // `enabled: false` means the account cannot spend credits at all, so a
  // "$0.00 of $20.00" row would describe a budget that does not exist.
  if (spend?.enabled === false) return null
  return {
    usedMinor,
    limitMinor,
    currency: typeof used?.currency === 'string' ? used.currency : 'USD',
    exponent: num(used?.exponent) ?? 2,
  }
}

/** Never throws: an unparseable body is indistinguishable from no answer, and
 *  both must degrade to "unavailable" rather than a crash inside a render. */
export function parseUsage(raw: unknown, fetchedAt: string): UsageSnapshot | null {
  if (!isRecord(raw)) return null

  const limits = Array.isArray(raw.limits) ? raw.limits : []
  const byKind = (kind: string) =>
    limits.find(l => isRecord(l) && l.kind === kind) ?? null

  const session = windowFrom(byKind('session')) ?? windowFrom(raw.five_hour)
  const weekly = windowFrom(byKind('weekly_all')) ?? windowFrom(raw.seven_day)
  if (!session && !weekly) return null

  return { session, weekly, extra: extraFrom(raw), fetchedAt }
}

/**
 * "1h 58m", "2d 3h", "now". Deliberately relative: an absolute reset time is a
 * UTC timestamp the user would have to convert, and the only question a gutter
 * meter answers is how long until this frees up.
 */
export function formatResetIn(resetsAt: string | null, nowMs: number): string | null {
  if (!resetsAt) return null
  const at = Date.parse(resetsAt)
  if (!Number.isFinite(at)) return null
  const ms = at - nowMs
  // A reset that has already passed but whose refreshed numbers have not
  // arrived yet is a real, if brief, state — say "now" rather than "-3m".
  if (ms <= 0) return 'now'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Minor units to a display string: 1234 -> "$12.34". */
export function formatMoney(minor: number, exponent: number, currency: string): string {
  const value = minor / 10 ** exponent
  const symbol = currency === 'USD' ? '$' : ''
  return `${symbol}${value.toFixed(exponent)}${symbol ? '' : ` ${currency}`}`
}
