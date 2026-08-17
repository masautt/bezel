import { describe, it, expect } from 'vitest'
import { parseUsage, formatResetIn, formatMoney, severityOf } from '@shared/usage'

const AT = '2026-08-10T01:00:00.000Z'

// Trimmed from a real response. Both shapes are present in it — the named
// five_hour/seven_day objects and the newer limits[] array — which is exactly
// why parseUsage prefers one and keeps the other as a fallback.
const REAL = {
  five_hour: { utilization: 66.0, resets_at: '2026-08-10T03:20:00.122035+00:00' },
  seven_day: { utilization: 56.0, resets_at: '2026-08-12T07:00:00.122076+00:00' },
  limits: [
    { kind: 'session', group: 'session', percent: 66, severity: 'normal', resets_at: '2026-08-10T03:20:00.122035+00:00' },
    { kind: 'weekly_all', group: 'weekly', percent: 56, severity: 'normal', resets_at: '2026-08-12T07:00:00.122076+00:00' },
    { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: null },
  ],
  spend: {
    used: { amount_minor: 0, currency: 'USD', exponent: 2 },
    limit: { amount_minor: 2000, currency: 'USD', exponent: 2 },
    enabled: true,
  },
}

describe('parseUsage', () => {
  it('reads both windows off a real response', () => {
    const snapshot = parseUsage(REAL, AT)!
    expect(snapshot.session).toMatchObject({ percent: 66, severity: 'normal' })
    expect(snapshot.weekly).toMatchObject({ percent: 56, severity: 'normal' })
    expect(snapshot.fetchedAt).toBe(AT)
  })

  it('takes weekly_all, never weekly_scoped — a per-model row is not the week', () => {
    // Both are group 'weekly'; matching on the group would pick whichever came
    // first and report 0% for an account that is more than half through.
    expect(parseUsage(REAL, AT)!.weekly!.percent).toBe(56)
  })

  it('falls back to the named windows when limits[] is absent', () => {
    const { limits, ...rest } = REAL
    void limits
    const snapshot = parseUsage(rest, AT)!
    expect(snapshot.session!.percent).toBe(66)
    expect(snapshot.weekly!.percent).toBe(56)
  })

  it("keeps the server's severity over the locally derived one", () => {
    // 40% would be 'normal' by the local rule; the server says otherwise, and it
    // knows about states this client does not.
    const raw = { limits: [{ kind: 'session', percent: 40, severity: 'critical', resets_at: null }] }
    expect(parseUsage(raw, AT)!.session!.severity).toBe('critical')
  })

  it('derives severity when the server sends none', () => {
    const raw = { five_hour: { utilization: 93, resets_at: null } }
    expect(parseUsage(raw, AT)!.session!.severity).toBe('critical')
  })

  it('returns null rather than a zeroed snapshot for a body it cannot read', () => {
    // A zeroed snapshot would paint two empty bars — the most reassuring thing
    // the widget can say at the one moment it knows nothing.
    expect(parseUsage(null, AT)).toBeNull()
    expect(parseUsage({}, AT)).toBeNull()
    expect(parseUsage({ error: 'unauthorized' }, AT)).toBeNull()
  })

  it('omits credits the account cannot actually spend', () => {
    const raw = { ...REAL, spend: { ...REAL.spend, enabled: false } }
    expect(parseUsage(raw, AT)!.extra).toBeNull()
  })

  it('reads credits in minor units, so no float ever holds money', () => {
    expect(parseUsage(REAL, AT)!.extra).toEqual({
      usedMinor: 0, limitMinor: 2000, currency: 'USD', exponent: 2,
    })
  })

  it('clamps a percentage outside 0..100 instead of overflowing the bar', () => {
    const raw = { five_hour: { utilization: 140, resets_at: null } }
    expect(parseUsage(raw, AT)!.session!.percent).toBe(100)
  })
})

describe('severityOf', () => {
  it('warns at 70 and turns critical at 90', () => {
    expect(severityOf(69)).toBe('normal')
    expect(severityOf(70)).toBe('warn')
    expect(severityOf(89)).toBe('warn')
    expect(severityOf(90)).toBe('critical')
  })
})

describe('formatResetIn', () => {
  const now = Date.parse('2026-08-10T01:00:00Z')

  it('counts minutes under an hour', () => {
    expect(formatResetIn('2026-08-10T01:42:00Z', now)).toBe('42m')
  })

  it('counts hours and minutes under a day', () => {
    expect(formatResetIn('2026-08-10T03:20:00Z', now)).toBe('2h 20m')
  })

  it('counts days and hours beyond that', () => {
    expect(formatResetIn('2026-08-12T07:00:00Z', now)).toBe('2d 6h')
  })

  // The window has rolled but the refreshed numbers have not arrived yet: a
  // real, brief state that must not render as a negative countdown.
  it('says "now" for a reset that has already passed', () => {
    expect(formatResetIn('2026-08-10T00:59:00Z', now)).toBe('now')
  })

  it('has nothing to say about a window with no scheduled reset', () => {
    expect(formatResetIn(null, now)).toBeNull()
    expect(formatResetIn('not a date', now)).toBeNull()
  })
})

describe('formatMoney', () => {
  it('renders minor units at the currency exponent', () => {
    expect(formatMoney(0, 2, 'USD')).toBe('$0.00')
    expect(formatMoney(2000, 2, 'USD')).toBe('$20.00')
    expect(formatMoney(1234, 2, 'EUR')).toBe('12.34 EUR')
  })
})
