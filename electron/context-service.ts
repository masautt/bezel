import { open, readdir, stat } from 'fs/promises'
import path from 'path'
// A relative import, not the `@shared` alias — see the note in specs-service.ts.
import {
  slugCandidates, pickTranscript, contextTokens, meterFrom, sessionTranscriptPaths,
  type ContextMeter, type TranscriptCandidate,
} from '../src/context-meter.js'
import { createStampCache, type StampCache } from './stamp-cache.js'

/**
 * How much of a transcript's tail to read.
 *
 * The answer is always in the LAST assistant entry, but a single entry can be
 * large (a tool result echoed into the message) and the file itself runs to
 * megabytes on a long session. 512 KiB reads in about a millisecond and has
 * held every entry observed; falling short of an assistant entry only yields
 * null, which the widget already renders as "no reading".
 */
export const TAIL_BYTES = 512 * 1024

/** The last `TAIL_BYTES` of a file, as text. Never throws. */
async function readTail(file: string, bytes = TAIL_BYTES): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(file, 'r')
    const size = (await handle.stat()).size
    const length = Math.min(size, bytes)
    const buffer = Buffer.allocUnsafe(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf-8')
  } catch {
    return null
  } finally {
    if (handle) try { await handle.close() } catch { /* already gone */ }
  }
}

/** `stat`, or null for a path that is not there. */
async function statOrNull(file: string) {
  try {
    return await stat(file)
  } catch {
    return null
  }
}

/** The newest `.jsonl` in one project directory, or null if there is none. */
async function newestTranscript(dir: string): Promise<{ file: string; mtimeMs: number } | null> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const stats = await Promise.all(
    names
      .filter(name => name.endsWith('.jsonl'))
      .map(async name => {
        const file = path.join(dir, name)
        try {
          return { file, mtimeMs: (await stat(file)).mtimeMs }
        } catch {
          return null // vanished between readdir and stat
        }
      })
  )
  let best: { file: string; mtimeMs: number } | null = null
  for (const entry of stats) {
    if (entry && (!best || entry.mtimeMs > best.mtimeMs)) best = entry
  }
  return best
}

/**
 * The last assistant turn in a transcript tail.
 *
 * Scanned BACKWARDS and stopped at the first hit: the tail holds many entries
 * and only the newest describes the window as it stands now. Unparseable lines
 * are skipped rather than fatal — the first line of a tail is almost always a
 * fragment of whatever entry the read cut through.
 */
export function lastAssistantUsage(tail: string): { tokens: number; model: string | null; at: string | null } | null {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === '' || !line.startsWith('{')) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (entry.type !== 'assistant') continue
    const message = entry.message as Record<string, unknown> | undefined
    const usage = message?.usage
    if (!usage) continue
    const tokens = contextTokens(usage)
    // A turn that reports a usage block with no input at all is not a window
    // reading — keep walking back rather than painting the bar empty.
    if (tokens === 0) continue
    return {
      tokens,
      model: typeof message?.model === 'string' ? message.model : null,
      at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
    }
  }
  return null
}

/**
 * How full the Claude session that owns this directory is.
 *
 * Reads ~/.claude/projects rather than asking the pane: the pty is a terminal,
 * not an API, and the running claude has no channel back to its host. The
 * transcript it writes on every turn is the only observable, and it is
 * authoritative — these are the counts the API itself returned.
 *
 * null means "no reading" in every case (no session here, unreadable file,
 * nothing but user turns yet). The widget must not distinguish them: they all
 * mean the same thing to the person looking at the bar.
 */
/**
 * The reading for one transcript, taken at most once per version of it.
 *
 * The tail read and its backwards parse are the entire cost of a poll — about
 * 8ms against a 10.9MB session — and between claude's turns the file does not
 * move, so every 5s that work re-derived an answer it already had. `stat` is
 * the cheap question that decides whether the expensive one is worth asking.
 */
const readTranscript = (
  cache: StampCache<ContextMeter | null>,
  file: string,
  st: { mtimeMs: number; size: number },
) =>
  cache.through(file, { mtimeMs: st.mtimeMs, size: st.size }, async () => {
    const tail = await readTail(file)
    if (!tail) return null
    const found = lastAssistantUsage(tail)
    return found ? meterFrom(found.tokens, found.model, found.at) : null
  })

/**
 * The meter's cache. Module scope, like main's `appsCache`: it belongs to the
 * process, not to a call, and the widget asking is a singleton.
 */
const defaultCache = createStampCache<ContextMeter | null>()

export async function readContextMeter(
  home: string,
  cwd: string,
  nowMs = Date.now(),
  sessionId?: string,
  /** Injected only by tests; the process shares one cache otherwise. */
  cache: StampCache<ContextMeter | null> = defaultCache,
): Promise<ContextMeter | null> {
  const projects = path.join(home, '.claude', 'projects')

  // Exact, when the tab knows which conversation is its own.
  //
  // The heuristic below picks the most recently written transcript under this
  // cwd and its ancestors — and every claude pane is rooted at CSOURCE_DIR
  // (else ~/source) rather than its tab's cwd, so EVERY session on the machine
  // lands in one project directory. Two tabs running meant both gauges showed
  // the same session: whichever claude answered last, not the one you were
  // looking at. An id turns that guess into a lookup.
  //
  // No transcript for a known id means the pane's first turn has not landed
  // yet. That is "no reading" — deliberately NOT a fall back to the heuristic,
  // which would go right back to showing another session's numbers.
  if (sessionId) {
    for (const candidate of sessionTranscriptPaths(home, cwd, sessionId)) {
      const st = await statOrNull(candidate)
      if (!st) continue // not this project directory
      return readTranscript(cache, candidate, st)
    }
    return null
  }
  // Asynchronous throughout: this is polled every 5s while the window has
  // focus, and the tail read alone measured 67ms cold against a 10.9MB
  // transcript — all of it previously blocking the thread that carries every
  // keystroke to every pane.
  const perSlug = await Promise.all(
    slugCandidates(cwd).map(async (slug, depth) => {
      const newest = await newestTranscript(path.join(projects, slug))
      return newest ? { ...newest, depth } : null
    })
  )
  const candidates: TranscriptCandidate[] = perSlug.filter((c): c is TranscriptCandidate => c !== null)

  const picked = pickTranscript(candidates, nowMs)
  if (!picked) return null

  // Re-stat rather than carrying the size down from newestTranscript: this is
  // the stamp the read is about to be taken against, and one syscall is nothing
  // beside the 512KB it decides whether to read.
  const st = await statOrNull(picked.file)
  if (!st) return null

  return readTranscript(cache, picked.file, st)
}
