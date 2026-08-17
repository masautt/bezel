import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { lastAssistantUsage, readContextMeter, TAIL_BYTES } from '../electron/context-service'
import { projectSlug } from '@shared/context-meter'

const HOME = mkdtempSync(join(tmpdir(), 'bezel-ctx-'))
const CWD = 'C:/Users/tester/source/orgs/devkit-inc/bezel'

const assistant = (tokens: number, model = 'claude-opus-5', timestamp = '2026-08-10T01:00:00.000Z') =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      model,
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: tokens - 2,
        output_tokens: 400,
      },
    },
  })

/** Writes a transcript into the project directory `slug` and back-dates it. */
function seed(slug: string, name: string, lines: string[], ageMs = 0) {
  const dir = join(HOME, '.claude', 'projects', slug)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, lines.join('\n') + '\n', 'utf-8')
  if (ageMs > 0) {
    const at = (Date.now() - ageMs) / 1000
    utimesSync(file, at, at)
  }
  return file
}

beforeAll(() => {
  mkdirSync(join(HOME, '.claude', 'projects'), { recursive: true })
})
afterAll(() => rmSync(HOME, { recursive: true, force: true }))

/**
 * The reading is cached per version of the transcript — see stamp-cache.ts.
 * Those unit tests prove the cache does not re-read; these prove the STAMP is
 * right against a real filesystem, which is the half that can only be wrong
 * here: an append that a coarse mtime failed to notice would pin the meter to
 * a stale number for the rest of the session, and the widget would quietly
 * stop tracking the window it exists to report.
 */
describe('readContextMeter caching', () => {
  it('follows the transcript when a new turn is appended', async () => {
    const slug = projectSlug(CWD)
    const file = seed(slug, 'append-me.jsonl', [assistant(50_000)])

    const first = await readContextMeter(HOME, CWD)
    expect(first?.tokens).toBe(50_000)

    // A second turn lands, exactly as claude appends one.
    appendFileSync(file, assistant(90_000, 'claude-opus-5', '2026-08-10T02:00:00.000Z') + '\n', 'utf-8')

    const second = await readContextMeter(HOME, CWD)
    expect(second?.tokens, 'a cached reading must not outlive the file it came from').toBe(90_000)
  })

  it('gives the same answer when nothing has changed', async () => {
    const slug = projectSlug(CWD)
    seed(slug, 'steady.jsonl', [assistant(70_000)])

    const a = await readContextMeter(HOME, CWD)
    const b = await readContextMeter(HOME, CWD)

    expect(b).toEqual(a)
  })
})

describe('lastAssistantUsage', () => {
  it('reads the LAST assistant turn, not the first', () => {
    const tail = [assistant(1_000), assistant(64_000)].join('\n')
    expect(lastAssistantUsage(tail)!.tokens).toBe(64_000)
  })

  it('skips user turns and anything else in the file', () => {
    const tail = [
      assistant(64_000),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'something' }),
    ].join('\n')
    expect(lastAssistantUsage(tail)!.tokens).toBe(64_000)
  })

  // The first line of a tail is almost always a fragment of whatever entry the
  // read cut through, so a parse failure is normal, not exceptional.
  it('survives a truncated first line', () => {
    const tail = ['ken":123,"cut":"off"}', assistant(50_000)].join('\n')
    expect(lastAssistantUsage(tail)!.tokens).toBe(50_000)
  })

  it('keeps walking back past a turn that reports no input at all', () => {
    const empty = JSON.stringify({ type: 'assistant', message: { model: 'm', usage: { output_tokens: 5 } } })
    const tail = [assistant(30_000), empty].join('\n')
    expect(lastAssistantUsage(tail)!.tokens).toBe(30_000)
  })

  it('has no answer for a transcript with no assistant turn yet', () => {
    expect(lastAssistantUsage(JSON.stringify({ type: 'user' }))).toBeNull()
    expect(lastAssistantUsage('')).toBeNull()
  })

  it('carries the model and timestamp through', () => {
    const found = lastAssistantUsage(assistant(1_000, 'claude-sonnet-5', '2026-08-09T12:00:00.000Z'))!
    expect(found.model).toBe('claude-sonnet-5')
    expect(found.at).toBe('2026-08-09T12:00:00.000Z')
  })
})

describe('readContextMeter', () => {
  // Polled every 5s while the window has focus, and synchronous: a readdir, a
  // stat per transcript, then a 512 KiB tail read and a backwards JSON.parse —
  // all on the main thread. Measured 5.6ms warm, but 67ms cold, and the file it
  // reads grows to 10MB+ on a long session.
  it('reads without blocking its caller', () => {
    expect(readContextMeter(HOME, CWD)).toBeInstanceOf(Promise)
  })

  it('finds the session launched in the directory itself', async () => {
    seed(projectSlug(CWD), 'a.jsonl', [assistant(64_000)])
    const meter = (await readContextMeter(HOME, CWD))!
    expect(meter.tokens).toBe(64_000)
    expect(meter.limit).toBe(200_000)
    expect(meter.percent).toBe(32)
    expect(meter.model).toBe('claude-opus-5')
  })

  // The habit this exists for: claude started in ~/source while the shell pane
  // sits several directories deeper.
  it('climbs to an ancestor when the directory itself has no session', async () => {
    const deeper = `${CWD}/client/src`
    seed(projectSlug(CWD), 'a.jsonl', [assistant(64_000)])
    expect((await readContextMeter(HOME, deeper))!.tokens).toBe(64_000)
  })

  it('prefers a live deeper session over a busier ancestor', async () => {
    const ancestor = 'C:/Users/tester/source/orgs/devkit-inc'
    seed(projectSlug(CWD), 'a.jsonl', [assistant(10_000)])
    seed(projectSlug(ancestor), 'b.jsonl', [assistant(150_000)])
    expect((await readContextMeter(HOME, CWD))!.tokens).toBe(10_000)
  })

  it('takes the newest transcript within one project directory', async () => {
    const slug = projectSlug('C:/Users/tester/source/orgs/sbrain-inc/finapp')
    seed(slug, 'old.jsonl', [assistant(20_000)], 60 * 60 * 1000)
    seed(slug, 'new.jsonl', [assistant(30_000)])
    expect((await readContextMeter(HOME, 'C:/Users/tester/source/orgs/sbrain-inc/finapp'))!.tokens).toBe(30_000)
  })

  // Not a zeroed meter: an empty bar is a claim about a window that does not
  // exist. Every unreadable case has to collapse to the same "no reading".
  it('returns null when no session belongs to this directory', async () => {
    expect(await readContextMeter(HOME, 'C:/Users/tester/elsewhere/nothing/here')).toBeNull()
  })

  it('returns null rather than throwing when ~/.claude is not there at all', async () => {
    expect(await readContextMeter(join(HOME, 'no-such-home'), CWD)).toBeNull()
  })

  it('reads the tail of a transcript far larger than one read', async () => {
    // Padding entries the tail read will cut through, then the real answer.
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(4_000) } })
    const lines = Array.from({ length: Math.ceil(TAIL_BYTES / 4_000) + 40 }, () => filler)
    lines.push(assistant(88_000))
    const slug = projectSlug('C:/Users/tester/source/orgs/big/repo')
    seed(slug, 'big.jsonl', lines)
    expect((await readContextMeter(HOME, 'C:/Users/tester/source/orgs/big/repo'))!.tokens).toBe(88_000)
  })
})

describe('reading a specific session', () => {
  // The bug this closes. Every claude pane is rooted at CSOURCE_DIR (else
  // ~/source) rather than its tab's cwd, so EVERY session on the machine lands
  // in one project directory. pickTranscript then hands back whichever was
  // written most recently — so with two tabs running, both Window gauges showed
  // the same session, and it was whichever claude answered last rather than the
  // one you were looking at.
  const SESSION = 'aaaaaaaa-1111-4222-8333-444444444444'
  const OTHER = 'bbbbbbbb-2222-4333-8444-555555555555'

  it('reads the named session even when another was written more recently', async () => {
    const slug = projectSlug('C:/Users/tester/source')
    // Ours is older; the other tab's is live. Today's heuristic prefers the
    // live one, which is exactly the wrong answer.
    seed(slug, `${SESSION}.jsonl`, [assistant(30_000)], 60_000)
    seed(slug, `${OTHER}.jsonl`, [assistant(90_000)], 0)

    const meter = await readContextMeter(HOME, 'C:/Users/tester/source', Date.now(), SESSION)
    expect(meter?.tokens).toBe(30_000)
  })

  it('reports no reading when the named session has no transcript yet', async () => {
    // A pane whose claude has not written its first turn. Better nothing than
    // somebody else's numbers.
    const meter = await readContextMeter(HOME, 'C:/Users/tester/source', Date.now(), 'cccccccc-3333-4444-8555-666666666666')
    expect(meter).toBeNull()
  })

  it('falls back to the newest transcript when there is no id', async () => {
    // A claude the user started by hand in the shell pane: bezel never assigned
    // it an id, so the heuristic is the best available and must still work.
    const meter = await readContextMeter(HOME, 'C:/Users/tester/source', Date.now())
    expect(meter?.tokens).toBe(90_000)
  })
})
