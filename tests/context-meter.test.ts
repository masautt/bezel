import { describe, it, expect } from 'vitest'
import {
  projectSlug, slugCandidates, pickTranscript, contextTokens, contextLimit,
  meterFrom, formatTokens, formatLimit, shortModel, LIVE_MS, MAX_ANCESTORS,
} from '@shared/context-meter'

describe('projectSlug', () => {
  // The observed directory for a session launched in C:\Users\testuser\source.
  it('matches the directory Claude Code actually writes', () => {
    expect(projectSlug('C:\\Users\\testuser\\source')).toBe('C--Users-testuser-source')
  })

  it('is separator-agnostic, so callers need not care which form they hold', () => {
    expect(projectSlug('C:/Users/testuser/source')).toBe(projectSlug('C:\\Users\\testuser\\source'))
  })

  it('collapses dots too, so a dotted directory still resolves', () => {
    expect(projectSlug('C:/Users/testuser/.claude')).toBe('C--Users-testuser--claude')
  })
})

describe('slugCandidates', () => {
  it('walks up from the cwd, deepest first', () => {
    const out = slugCandidates('C:/Users/testuser/source/orgs/devkit-inc/bezel')
    expect(out[0]).toBe('C--Users-testuser-source-orgs-devkit-inc-bezel')
    expect(out[1]).toBe('C--Users-testuser-source-orgs-devkit-inc')
  })

  // Four is what it takes to climb orgs/<owner>/<repo> back to ~/source; past
  // that the next match is the home directory, whose sessions belong to no tab.
  it('reaches ~/source from a repo but stops before home', () => {
    const out = slugCandidates('C:/Users/testuser/source/orgs/devkit-inc/bezel')
    expect(out).toContain('C--Users-testuser-source')
    expect(out).not.toContain('C--Users-testuser')
    expect(out).toHaveLength(MAX_ANCESTORS + 1)
  })

  it('stops at the drive rather than emitting an empty slug', () => {
    expect(slugCandidates('C:/Users')).toEqual(['C--Users'])
  })
})

describe('pickTranscript', () => {
  const now = Date.parse('2026-08-10T01:00:00Z')
  const fresh = now - 60_000
  const old = now - LIVE_MS - 60_000

  it('prefers the deepest directory that is still live', () => {
    const picked = pickTranscript([
      { file: 'repo.jsonl', mtimeMs: fresh, depth: 0 },
      { file: 'source.jsonl', mtimeMs: now, depth: 2 },
    ], now)
    // Newest-globally would pick source.jsonl — another pane's busier session —
    // and attribute its window to this repo.
    expect(picked!.file).toBe('repo.jsonl')
  })

  it('climbs to an ancestor when the deeper directory has gone stale', () => {
    const picked = pickTranscript([
      { file: 'repo.jsonl', mtimeMs: old, depth: 0 },
      { file: 'source.jsonl', mtimeMs: fresh, depth: 2 },
    ], now)
    expect(picked!.file).toBe('source.jsonl')
  })

  it('falls back to the most recent when nothing is live', () => {
    const picked = pickTranscript([
      { file: 'a.jsonl', mtimeMs: old - 10_000, depth: 0 },
      { file: 'b.jsonl', mtimeMs: old, depth: 1 },
    ], now)
    expect(picked!.file).toBe('b.jsonl')
  })

  it('has no answer when there are no transcripts', () => {
    expect(pickTranscript([], now)).toBeNull()
  })
})

describe('contextTokens', () => {
  // A cached token occupies a position in the window exactly like a fresh one.
  it('counts both cache legs, not just fresh input', () => {
    expect(contextTokens({
      input_tokens: 2,
      cache_creation_input_tokens: 576,
      cache_read_input_tokens: 63209,
      output_tokens: 415,
    })).toBe(63787)
  })

  it('excludes output, which is not in the window until the next turn', () => {
    expect(contextTokens({ input_tokens: 100, output_tokens: 9999 })).toBe(100)
  })

  it('treats a missing or malformed usage block as zero', () => {
    expect(contextTokens(undefined)).toBe(0)
    expect(contextTokens({ input_tokens: 'lots' })).toBe(0)
  })
})

describe('contextLimit', () => {
  it('defaults to the standard window', () => {
    expect(contextLimit('claude-opus-5', 50_000)).toBe(200_000)
  })

  it('reads the long window off an id that carries the suffix', () => {
    expect(contextLimit('claude-opus-5[1m]', 1_000)).toBe(1_000_000)
  })

  // The transcript records the bare id, so the tier cannot be read off it —
  // exceeding the standard window is itself the proof.
  it('infers the long window from a session that has already outgrown 200k', () => {
    expect(contextLimit('claude-opus-5', 240_000)).toBe(1_000_000)
  })

  it('never guesses long on an unknown model that fits in standard', () => {
    expect(contextLimit(null, 199_000)).toBe(200_000)
  })
})

describe('meterFrom', () => {
  it('turns a count into a percentage and a severity', () => {
    const m = meterFrom(190_000, 'claude-opus-5', '2026-08-10T01:00:00Z')
    expect(m).toMatchObject({ tokens: 190_000, limit: 200_000, percent: 95, severity: 'critical' })
  })

  // The inferred tier only ever reads pessimistically: crossing 200k moves the
  // bar DOWN, never up into a falsely comfortable reading.
  it('re-gauges against the long window once the session crosses it', () => {
    expect(meterFrom(210_000, 'claude-opus-5', null).percent).toBe(21)
  })
})

describe('formatting', () => {
  it('keeps token counts to three digits or so', () => {
    expect(formatTokens(980)).toBe('980')
    expect(formatTokens(142_400)).toBe('142k')
    expect(formatTokens(1_020_000)).toBe('1.02M')
  })

  it('labels the window', () => {
    expect(formatLimit(200_000)).toBe('200k')
    expect(formatLimit(1_000_000)).toBe('1M')
  })

  it('drops the vendor prefix, which is the same on every row', () => {
    expect(shortModel('claude-opus-5')).toBe('opus-5')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
    expect(shortModel(null)).toBeNull()
  })
})
