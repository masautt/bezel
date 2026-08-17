import { normalizePath } from './paths.js'

export type LinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string; line?: number; col?: number }

// Only the two schemes the main process will actually open. `shell:openExternal`
// applies the same guard, so anything else is refused here rather than making a
// round trip that returns undefined.
const WEB_URL = /^https?:\/\/\S+$/i

// Same shape parseOsc7 consumes: file://<host>/<path>, host optional and ignored.
const FILE_URL = /^file:\/\/[^/]*\/(.+)$/i

// Trailing `:line` and `:line:col`. The drive colon in `C:/x` cannot be caught by
// this: it is followed by a slash, never a digit. The lazy prefix means
// `C:/x/foo.ts:42:7` splits at the LAST two groups, not the first.
const LINE_COL = /^(.*?)(?::(\d+))(?::(\d+))?$/

const ABSOLUTE = /^(?:[A-Za-z]:\/|\/)/

/**
 * Turns one piece of matched terminal text into something openable, or null.
 *
 * Fed from three places with different notions of "matched": the web-links addon,
 * which hands over a URI it found itself; the OSC 8 link handler, where the
 * emitting program chose the URI; and the file-path link provider below. Both of
 * the first two can produce `file://`, so neither can be assumed to be a web URL.
 *
 * `cwd` is the pane's live OSC 7 directory. Relative paths are the common case in
 * terminal output — compilers and test runners print them — and they are
 * meaningless without it.
 */
export function classifyLinkTarget(text: string, cwd: string): LinkTarget | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fileUrl = FILE_URL.exec(trimmed)
  if (fileUrl) {
    let decoded: string
    try {
      decoded = decodeURIComponent(fileUrl[1])
    } catch {
      return null
    }
    return toFileTarget(decoded, cwd)
  }

  if (WEB_URL.test(trimmed)) return { kind: 'url', url: trimmed }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null

  return toFileTarget(trimmed, cwd)
}

/** The four facts about a mouse event that decide whether a link opens. */
export interface LinkClickFacts {
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** `MouseEvent.button`. 0 is left. */
  button: number
}

/**
 * Ctrl+click, the same gesture VS Code and Windows Terminal use.
 *
 * Every exclusion here is a gesture the pane already owes to something else: a
 * plain click places the cursor and starts a selection drag, shift+click extends
 * one, and the right button belongs to the context menu. A link that stole any of
 * them would break the terminal to decorate it.
 */
export function isLinkActivation(f: LinkClickFacts): boolean {
  if (f.button !== 0) return false
  return f.ctrl && !f.shift && !f.alt
}

export interface FilePathMatch {
  /** 0-based index into the line where the path starts. */
  start: number
  /** 0-based index one past the last character of the path. */
  end: number
  target: LinkTarget
}

// A candidate is any run of non-whitespace containing a separator. Requiring the
// separator is what keeps this from proposing every word in the scrollback.
const CANDIDATE = /\S*[/\\]\S*/g

// Terminal output is prose as often as it is a path list: `edited src/links.ts.`
// ends in a sentence, not a file extension. A trailing `:` goes too — a `:line`
// suffix ends in a digit, so nothing real is lost.
const TRAILING_PUNCTUATION = /[.,;:)\]}>'"]+$/

/**
 * Scans one rendered terminal line for file paths and reports where they sit.
 *
 * URLs are deliberately dropped: the web-links addon already decorates those, and
 * two providers claiming the same cells would fight over the hover state.
 */
export function findFilePaths(line: string, cwd: string): FilePathMatch[] {
  const matches: FilePathMatch[] = []
  for (const found of line.matchAll(CANDIDATE)) {
    const raw = found[0].replace(TRAILING_PUNCTUATION, '')
    if (!raw) continue
    const target = classifyLinkTarget(raw, cwd)
    if (!target || target.kind !== 'file') continue
    matches.push({ start: found.index, end: found.index + raw.length, target })
  }
  return matches
}

function toFileTarget(raw: string, cwd: string): LinkTarget | null {
  const normalized = normalizePath(raw)
  const match = LINE_COL.exec(normalized)
  const body = match ? match[1] : normalized
  const line = match ? Number(match[2]) : undefined
  const col = match?.[3] ? Number(match[3]) : undefined

  // A path has a separator. Without this every bare word in the scrollback —
  // every prompt, every log level — would resolve to a plausible-looking file
  // under cwd and light up as a link.
  if (!body.includes('/')) return null

  const path = ABSOLUTE.test(body) ? body : `${normalizePath(cwd)}/${body.replace(/^\.\//, '')}`

  const target: LinkTarget = { kind: 'file', path }
  if (line !== undefined) target.line = line
  if (col !== undefined) target.col = col
  return target
}
