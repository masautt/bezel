// The loading screen's text, and how one is chosen. Pure and browser-safe (no
// DOM, no Node) for the same reason as the rest of src/: this file is compiled
// by all four tsconfig projects. localStorage access and timers live in the
// component; everything decidable without them lives here, where it is testable.

/** One candidate line. `weight` is relative — 2 is twice as likely as 1. */
export interface LoadingMessage {
  text: string
  weight: number
}

/**
 * Where the renderer caches the last remote pull.
 *
 * Versioned in the key rather than inside the payload: a shape change should
 * MISS the cache and fall back to the built-ins, not read a stale shape and
 * have to repair it. Bumping the suffix is the whole migration.
 */
export const LOADING_CACHE_KEY = 'bezel.loadingMessages.v1'

/**
 * The offline floor, compiled into the renderer.
 *
 * This is not a placeholder for the remote set — it is what a fresh install with
 * no network and no cache shows, and the ONLY thing available on the very first
 * launch on a new machine. Deliberately a small, good subset rather than all 45:
 * every one of these ships in the bundle, and three rotations is all an 8s wait
 * has time for.
 *
 * Stored without a trailing ellipsis, matching the table — the component draws
 * its own animated dots, so baking them in would double them.
 */
export const BUILTIN_LOADING_MESSAGES: readonly LoadingMessage[] = [
  { text: 'Blocking the main thread, as is tradition', weight: 1 },
  { text: 'Negotiating with six MCP connectors', weight: 1 },
  { text: 'Waiting on conpty to acknowledge our existence', weight: 1 },
  { text: 'Warming a spare terminal you will never notice', weight: 1 },
  { text: 'Consulting the oh-my-posh oracle', weight: 1 },
  { text: 'Resolving a nerd font, any nerd font', weight: 1 },
  { text: 'Reticulating splines', weight: 1 },
  { text: 'Teaching the hamster to type', weight: 1 },
  { text: 'Apologizing to the garbage collector', weight: 1 },
  { text: 'Counting to eight, slowly', weight: 1 },
  { text: 'Sharpening the cursor', weight: 1 },
  { text: 'Grepping the abyss', weight: 1 },
]

/** Weights are clamped into this range; see normalizeMessages. */
const MAX_WEIGHT = 1000

/**
 * Coerce anything — a Supabase result, a hand-edited localStorage blob, a null —
 * into usable messages, dropping whatever cannot be salvaged.
 *
 * One function for both sources on purpose. They differ only in the key holding
 * the string (`message` remotely, `text` once cached), and accepting either
 * means the cache can store exactly what the pull returned without a conversion
 * step that could itself be wrong.
 *
 * Returns [] rather than throwing or falling back to the built-ins: the CALLER
 * decides what an empty set means, and only it knows whether it still has a
 * previous set worth keeping.
 */
export function normalizeMessages(input: unknown): LoadingMessage[] {
  if (!Array.isArray(input)) return []
  const out: LoadingMessage[] = []
  const seen = new Set<string>()
  for (const row of input) {
    if (!row || typeof row !== 'object') continue
    const raw = (row as { text?: unknown; message?: unknown })
    const value = typeof raw.text === 'string' ? raw.text : raw.message
    if (typeof value !== 'string') continue
    const text = value.trim()
    // A blank line would render as an empty loading screen, which reads as a
    // broken app rather than as a quiet one.
    if (!text) continue
    // The table has a unique (app, message), but the cache and the built-ins can
    // still overlap with a pull. A duplicate is not corrupt, just heavier than
    // intended, so drop it rather than the whole set.
    if (seen.has(text)) continue
    seen.add(text)
    const w = (row as { weight?: unknown }).weight
    // Non-finite, negative and absurd weights all collapse to something sane:
    // a zero or NaN weight would silently make a line unreachable, and a huge
    // one would make it the only line anyone ever sees.
    const weight = typeof w === 'number' && Number.isFinite(w) && w > 0 ? Math.min(Math.floor(w), MAX_WEIGHT) : 1
    out.push({ text, weight })
  }
  return out
}

/**
 * Index of the next message to show, weighted, avoiding an immediate repeat.
 *
 * `random` is injected (not Math.random) so the choice is testable — the whole
 * reason this is a separate function from the component.
 *
 * `avoid` is the currently-shown index, or -1 at first paint. Skipping it
 * matters more than it sounds: a rotation that shows the same line twice in a
 * row looks frozen, which is the exact impression the loading screen exists to
 * dispel. Ignored when there is only one message, where a repeat is the only
 * option.
 */
export function pickIndex(messages: readonly LoadingMessage[], random: number, avoid = -1): number {
  if (messages.length === 0) return -1
  if (messages.length === 1) return 0
  const eligible: number[] = []
  for (let i = 0; i < messages.length; i++) if (i !== avoid) eligible.push(i)
  const total = eligible.reduce((sum, i) => sum + messages[i].weight, 0)
  // Clamped rather than trusted: a `random` of exactly 1 (or a caller passing
  // something out of range) would otherwise walk off the end and return -1.
  let target = Math.min(Math.max(random, 0), 0.999999) * total
  for (const i of eligible) {
    target -= messages[i].weight
    if (target < 0) return i
  }
  return eligible[eligible.length - 1]
}
