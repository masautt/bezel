import { describe, it, expect } from 'vitest'
import {
  BUILTIN_LOADING_MESSAGES,
  normalizeMessages,
  pickIndex,
  type LoadingMessage,
} from '../src/loading-messages'

const m = (text: string, weight = 1): LoadingMessage => ({ text, weight })

describe('normalizeMessages', () => {
  it('accepts the table shape and the cached shape alike', () => {
    // The pull returns `message`; the cache stores `text`. Accepting both is
    // what lets the cache store exactly what the pull returned.
    expect(normalizeMessages([{ message: 'from supabase', weight: 2 }])).toEqual([m('from supabase', 2)])
    expect(normalizeMessages([{ text: 'from cache', weight: 3 }])).toEqual([m('from cache', 3)])
  })

  it('returns empty for anything that is not an array', () => {
    // The caller decides what empty means — it is the only one that knows
    // whether it still holds a usable previous set.
    for (const junk of [null, undefined, 'nope', 42, {}]) {
      expect(normalizeMessages(junk)).toEqual([])
    }
  })

  it('drops rows with no usable string, keeping the rest', () => {
    const out = normalizeMessages([
      { message: 'keep me' },
      null,
      'a bare string',
      { weight: 5 },
      { message: 42 },
      { message: '   ' }, // blank would render as an empty loading screen
      { message: 'keep me too' },
    ])
    expect(out.map(x => x.text)).toEqual(['keep me', 'keep me too'])
  })

  it('trims, and de-duplicates on the trimmed text', () => {
    const out = normalizeMessages([{ message: '  spaced  ' }, { message: 'spaced' }])
    expect(out).toEqual([m('spaced')])
  })

  it('repairs weights that would make a line unreachable or omnipresent', () => {
    const out = normalizeMessages([
      { message: 'zero', weight: 0 },
      { message: 'negative', weight: -4 },
      { message: 'nan', weight: Number.NaN },
      { message: 'infinite', weight: Number.POSITIVE_INFINITY },
      { message: 'string', weight: '7' },
      { message: 'fractional', weight: 2.9 },
      { message: 'huge', weight: 999999 },
    ])
    expect(out.map(x => x.weight)).toEqual([1, 1, 1, 1, 1, 2, 1000])
  })
})

describe('pickIndex', () => {
  it('returns -1 only when there is nothing to show', () => {
    expect(pickIndex([], 0.5)).toBe(-1)
  })

  it('honours the weights', () => {
    // 'rare' occupies [0, 0.25), 'common' the rest.
    const messages = [m('rare', 1), m('common', 3)]
    expect(pickIndex(messages, 0)).toBe(0)
    expect(pickIndex(messages, 0.24)).toBe(0)
    expect(pickIndex(messages, 0.26)).toBe(1)
    expect(pickIndex(messages, 0.99)).toBe(1)
  })

  it('never repeats the line already on screen', () => {
    const messages = [m('a'), m('b'), m('c')]
    // Every random value, with 'b' showing, must land somewhere else — a
    // rotation that repeats looks frozen, which is what this screen exists to
    // dispel.
    for (let r = 0; r < 1; r += 0.05) {
      expect(pickIndex(messages, r, 1)).not.toBe(1)
    }
  })

  it('repeats only when there is no alternative', () => {
    expect(pickIndex([m('only')], 0.5, 0)).toBe(0)
  })

  it('stays in range for out-of-range randoms', () => {
    // A `random` of exactly 1 would otherwise walk off the end of the weights.
    const messages = [m('a'), m('b')]
    for (const r of [1, 1.5, -0.2, Number.NaN]) {
      const i = pickIndex(messages, r)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(messages.length)
    }
  })
})

describe('the built-in set', () => {
  it('is big enough to rotate without repeating', () => {
    // The launch wait shows about three lines; fewer than a handful here and
    // the offline floor would visibly loop.
    expect(BUILTIN_LOADING_MESSAGES.length).toBeGreaterThanOrEqual(6)
  })

  it('carries no trailing ellipsis — the component draws its own dots', () => {
    for (const item of BUILTIN_LOADING_MESSAGES) {
      expect(item.text).not.toMatch(/[.…]+$/)
    }
  })

  it('survives its own normalizer unchanged', () => {
    expect(normalizeMessages([...BUILTIN_LOADING_MESSAGES])).toEqual([...BUILTIN_LOADING_MESSAGES])
  })
})
