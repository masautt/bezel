// How full the active Claude Code session's context window is, as plain data.
// Browser-safe: no Node builtins. The transcript is read in
// electron/context-service.ts; everything here is the decisions that read
// depends on — which project directory belongs to a cwd, which of several
// transcripts is the live one, and what the numbers mean.

import { severityOf, type Severity } from './usage.js'

export interface ContextMeter {
  /** Everything the model saw on its last turn: fresh input + both cache legs. */
  tokens: number
  limit: number
  percent: number
  severity: Severity
  model: string | null
  /** ISO of the transcript entry these numbers came from — the widget shows
   *  this as staleness rather than implying the reading is live. */
  at: string | null
}

/**
 * Claude Code names a project directory after the cwd it was launched in, with
 * every character that is not a letter or digit replaced by a dash — so
 * `C:\Users\testuser\source` becomes `C--Users-testuser-source` (drive colon and
 * separator both collapse to a dash, which is why it starts with two).
 *
 * Separator-agnostic by construction: a path already normalized to forward
 * slashes produces the identical slug, so callers need not care which form they
 * hold.
 */
export function projectSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * How far up the tree to look for the session that owns a pane.
 *
 * A tab's cwd is where its SHELL is; the claude pane was launched at the tab's
 * root and its user may well have started claude a level or two higher (this
 * machine's own habit is `~/source`). Three is exactly the climb from
 * `~/source/orgs/<owner>/<repo>` back to `~/source` and no further — a fourth
 * step reaches the home directory, whose transcripts belong to no tab in
 * particular and would otherwise become every pane's fallback reading.
 */
export const MAX_ANCESTORS = 3

/** The cwd and its ancestors, deepest first. */
export function slugCandidates(cwd: string, maxAncestors = MAX_ANCESTORS): string[] {
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const out: string[] = []
  for (let i = 0; i <= maxAncestors && parts.length - i > 1; i++) {
    out.push(projectSlug(parts.slice(0, parts.length - i).join('/')))
  }
  return out
}

export interface TranscriptCandidate {
  /** Absolute path to the newest .jsonl in one candidate project directory. */
  file: string
  mtimeMs: number
  /** 0 = the cwd itself, 1 = its parent, and so on. */
  depth: number
}

/**
 * A session is considered live for this long after its last write. Six hours
 * comfortably covers a pane left idle over lunch while still expiring
 * yesterday's.
 */
export const LIVE_MS = 6 * 60 * 60 * 1000

/**
 * Which transcript belongs to this pane.
 *
 * Deepest-first, not newest-first: the most specific directory that has a
 * RECENTLY written transcript is the pane's own session, and preferring newest
 * globally would let a busy session in `~/source` shadow the quiet one actually
 * running in this repo. Only when nothing is live does it fall back to the most
 * recent of them — a stale reading the widget labels as stale beats no reading
 * at all, and beats silently attributing another pane's context to this one.
 */
export function pickTranscript(
  candidates: TranscriptCandidate[],
  nowMs: number
): TranscriptCandidate | null {
  if (candidates.length === 0) return null
  const byDepth = [...candidates].sort((a, b) => a.depth - b.depth)
  const live = byDepth.find(c => nowMs - c.mtimeMs <= LIVE_MS)
  if (live) return live
  return [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
}

/**
 * What the window actually held on that turn.
 *
 * Cache reads count: a cached token occupies a position in the window exactly
 * like a fresh one — it is only cheaper, not absent. Output is excluded because
 * it is not in the window yet; it lands in the NEXT turn's input and is counted
 * then.
 */
export function contextTokens(usage: unknown): number {
  if (typeof usage !== 'object' || usage === null) return 0
  const u = usage as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens)
}

export const STANDARD_LIMIT = 200_000
export const LONG_LIMIT = 1_000_000

/**
 * Which window this session is running in.
 *
 * The transcript records the model as a bare id (`claude-opus-5`) — the `[1m]`
 * suffix that selects the long window is part of the id the harness was
 * INVOKED with and never reaches the file, so the tier cannot simply be read
 * off it. Observation settles it instead: a session that has already exceeded
 * the standard window is definitionally in the long one. That self-corrects the
 * moment it matters (a 1M session below 200k is gauged against 200k, and the
 * bar only ever reads pessimistically — never a falsely comfortable one).
 */
export function contextLimit(model: string | null, tokens: number): number {
  const long = model != null && /\[1m\]/.test(model)
  if (long || tokens > STANDARD_LIMIT) return LONG_LIMIT
  return STANDARD_LIMIT
}

export function meterFrom(
  tokens: number,
  model: string | null,
  at: string | null
): ContextMeter {
  const limit = contextLimit(model, tokens)
  const percent = Math.max(0, Math.min(100, Math.round((tokens / limit) * 100)))
  return { tokens, limit, percent, severity: severityOf(percent), model, at }
}

/** "142k", "1.02M", "980" — three significant-ish digits, never more. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return `${tokens}`
}

/** The window as a label: "200k" / "1M". */
export function formatLimit(limit: number): string {
  return limit >= 1_000_000 ? `${limit / 1_000_000}M` : `${limit / 1_000}k`
}

/** `claude-opus-5` -> `opus-5`. The vendor prefix is the same on every row. */
export function shortModel(model: string | null): string | null {
  if (!model) return null
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/**
 * Every place a conversation with this id could be stored, deepest cwd first.
 *
 * Exists because bezel assigns a session id at spawn (`--session-id`) but claude
 * does not create the conversation until it has content — so a pane you opened
 * and never typed in has an id and no transcript. Restoring that tab used to
 * run `--resume <uuid>` against nothing and print "No conversation found with
 * session ID", which the failed-resume heuristic could not catch either, since
 * claude emits that error rather than exiting silently.
 *
 * Checking for the file is deterministic where the timing rule is a guess, so
 * the caller degrades a missing transcript to a fresh session instead.
 */
export function sessionTranscriptPaths(home: string, cwd: string, sessionId: string): string[] {
  const root = home.replace(/\\/g, '/').replace(/\/+$/, '')
  return slugCandidates(cwd).map(slug => `${root}/.claude/projects/${slug}/${sessionId}.jsonl`)
}
