// Rewrites Claude Code's startup mascot into bezel's own wordmark on the way
// from the pty to the terminal. Pure and browser-safe, like env.ts: takes a
// chunk of pane output, returns the chunk to actually render.
//
// Claude Code offers no way to suppress its banner — there is no flag, no
// setting, and no environment variable (the only banner-related one is
// CLAUDE_CODE_FORCE_FULL_LOGO, which forces the LARGER logo). Its `hideLogo`
// and `hideWelcomeChrome` props exist but are internal, defaulting to false and
// only ever set from other props. Since bezel owns the pty, the substitution
// happens here instead: the mascot never reaches xterm.js at all.
//
// The version / model / effort / plan / cwd text is left exactly as Claude
// printed it, which is the whole reason this runs downstream of claude rather
// than printing a banner before it. Those values are not knowable ahead of
// time: no `model` key is persisted to settings.json, and both
// orgModelDefaultCache and modelAccessCache in ~/.claude.json are null. The
// model is resolved at runtime from the account.
//
// WHY THIS IS A CURSOR TRACKER AND NOT A REGEX
//
// The banner is not printed as lines of text. It is PAINTED, with absolute
// positioning, and the captured bytes look like this:
//
//   ESC[2;2H ▐▛███▜▌ ESC[3C Claude ESC[1C Code ESC[1C v2.1.226 CR LF
//   ▝▜█████▛▘ ESC[2C Opus ESC[1C 5 … ESC[4;3H ▘▘ ESC[1C ▝▝ ESC[4C ~\source
//
// Three consequences, each of which defeats line-oriented matching:
//   - The art is placed by CUP (ESC[row;colH). It does not begin a line, so a
//     ^-anchored pattern never sees it.
//   - The gaps are cursor-forward moves (ESC[3C), not spaces — including the
//     single spaces BETWEEN WORDS of the info text.
//   - One newline-delimited "line" can hold two art rows plus the status bar,
//     and the third art row arrives as TWO separate runs (▘▘ then ▝▝).
//
// So the stream is tokenized and the cursor is tracked, which also buys the
// thing a substitution otherwise cannot have: the wordmark is 15 columns wide
// where the mascot is 7, and re-emitting an absolute column (CHA) after the art
// keeps every info row landing on one column regardless.

/** The wordmark, one row per mascot row. */
const WORDMARK = ['╔╗ ╔═╗╔═╗╔═╗╦', '╠╩╗║╣ ╔═╝║╣ ║', '╚═╝╚═╝╚═╝╚═╝╩═╝']

/** Widest wordmark row; every row is padded to it so the art has a flush edge. */
const ART_WIDTH = Math.max(...WORDMARK.map(r => r.length))

/** Left margin, matching the column Claude starts its own top row at. */
const START_COL = 2

/** Columns between the wordmark and the info text. */
const GAP = 3

/**
 * Where the info text is re-anchored. Claude lands all three rows on column 12
 * by using a different gap per row (3, 2, and 4-after-a-nested-run); the
 * wordmark is wider, so the column moves right — but it moves by the same
 * amount for every row, which is what keeps the block aligned.
 */
const INFO_COL = START_COL + ART_WIDTH + GAP

/**
 * An art run: the glyphs the mascot is built from, plus the SPACES claude pads
 * its rows with.
 *
 * Matching the character CLASS rather than the exact art is deliberate: the
 * logo is assembled per row from parts (r1L/r1E/r1R, r2L/r2R) with four
 * variants — default, look-left, look-right, arms-up — so any literal string
 * would match one variant and miss three.
 *
 * Admitting spaces is what 2.1.228 forced. 2.1.226 emitted every row as
 * pure-glyph runs placed by CUP and separated by cursor-forward, so a
 * glyphs-only match on the whole token was exact. 2.1.228 emits " ▐" and
 * "  ▘▘ ▝▝  " as ordinary spaced text, which that match skipped entirely —
 * leaving the mascot's feet on screen and the last info row six columns left
 * of the two above it.
 */
const ART_RUN = /^[▀▄█▌▐▖-▟ ]+$/
const GLYPH = /[▀▄█▌▐▖-▟]/g

/** Glyphs in a run. Spaces pad the art but must not count toward anchoring. */
function glyphCount(text: string): number {
  return (text.match(GLYPH) ?? []).length
}

/**
 * Whether a text token is part of the art. Requiring at least one glyph keeps
 * a run of plain spaces — which any output can contain — from being swallowed
 * as art once the banner is anchored.
 */
function isArtRun(text: string): boolean {
  return ART_RUN.test(text) && glyphCount(text) > 0
}

/**
 * Glyphs needed to call a run "the top of a banner". The top rows are 7 and 9
 * glyphs wide; the third row's runs are only 2, but those are recognised by
 * position once the banner is found rather than by size.
 */
const MIN_ANCHOR_GLYPHS = 5

/**
 * Longest art fragment held back waiting for the rest of its run. The widest
 * mascot row is 9 glyphs, so this is slack — it exists only so a stream of
 * block characters that is not a banner cannot buffer without bound.
 */
const GLYPH_CARRY_LIMIT = 64

/**
 * Stop looking after this many bytes. The banner is the first thing a claude
 * pane prints, so this only has to cover startup — and it bounds how long
 * unrelated block-glyph output (an ASCII chart, a progress bar) is exposed to
 * the tracker at all.
 */
const SCAN_BUDGET = 256 * 1024

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'csi'; text: string; final: string; params: number[] }
  | { kind: 'osc'; text: string }
  | { kind: 'esc'; text: string }
  | { kind: 'cr' | 'lf'; text: string }

/**
 * Split `s` into tokens. Returns `rest` — a trailing fragment that is the start
 * of an escape sequence but not yet a whole one, which the caller must carry
 * into the next chunk. Real captures split mid-banner, so this matters.
 */
function tokenize(s: string): { tokens: Token[]; rest: string } {
  const tokens: Token[] = []
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '\r') {
      tokens.push({ kind: 'cr', text: ch })
      i += 1
      continue
    }
    if (ch === '\n') {
      tokens.push({ kind: 'lf', text: ch })
      i += 1
      continue
    }

    if (ch === ESC) {
      const next = s[i + 1]
      if (next === undefined) return { tokens, rest: s.slice(i) }

      if (next === '[') {
        // CSI: parameter bytes, then a final byte in @-~.
        let j = i + 2
        while (j < s.length && /[0-9;:?<>=!]/.test(s[j])) j += 1
        if (j >= s.length) return { tokens, rest: s.slice(i) }
        const text = s.slice(i, j + 1)
        const params = s
          .slice(i + 2, j)
          .split(';')
          .map(p => (p === '' ? NaN : Number(p)))
        tokens.push({ kind: 'csi', text, final: s[j], params })
        i = j + 1
        continue
      }

      if (next === ']') {
        // OSC: runs to BEL or ST. The title update sits right before the
        // banner, so mis-parsing it would desynchronise everything after.
        const bel = s.indexOf(BEL, i)
        const st = s.indexOf(`${ESC}\\`, i)
        const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
        if (end === -1) return { tokens, rest: s.slice(i) }
        const stop = end === st ? end + 2 : end + 1
        tokens.push({ kind: 'osc', text: s.slice(i, stop) })
        i = stop
        continue
      }

      tokens.push({ kind: 'esc', text: s.slice(i, i + 2) })
      i += 2
      continue
    }

    let j = i
    while (j < s.length && s[j] !== ESC && s[j] !== '\r' && s[j] !== '\n') j += 1
    tokens.push({ kind: 'text', text: s.slice(i, j) })
    i = j
  }

  return { tokens, rest: '' }
}

/** A CSI parameter, defaulting the way terminals default it (empty means 1). */
function param(params: number[], index: number, fallback: number): number {
  const v = params[index]
  return v === undefined || Number.isNaN(v) ? fallback : v
}

export type BannerRewriter = (chunk: string) => string

/**
 * A rewriter for one pane. Stateful across chunks — the banner is reliably
 * split across pty reads — so each pane needs its own.
 */
export function createBannerRewriter(): BannerRewriter {
  let row = 1
  let col = 1
  let scanned = 0
  let carry = ''
  let done = false

  /** Terminal row of wordmark row 0, once the banner has been found. */
  let baseRow: number | null = null
  /**
   * Latched as soon as the banner is located. After that the tracker only ever
   * rewrites rows of THAT banner — so a repaint in place is still handled, but
   * an ASCII chart or progress bar later in the session is not mistaken for
   * art and mangled.
   */
  let anchored = false

  /** The row currently being replaced, and which wordmark row it takes. */
  let artRow: number | null = null
  let artIndex = 0

  /**
   * SGR sequences seen INSIDE the current art run, replayed by closeArt. They
   * cannot simply be emitted where they appear: they would then apply to the
   * wordmark, which is painted later, at closeArt. Held instead so the run's
   * net colour state lands after the art and before the info text.
   */
  let pendingSgr: string[] = []

  return function rewrite(chunk: string): string {
    if (done) return chunk

    scanned += chunk.length
    if (scanned > SCAN_BUDGET) {
      done = true
      const flushed = carry + chunk
      carry = ''
      return flushed
    }

    const { tokens, rest } = tokenize(carry + chunk)
    carry = rest

    // A read can end in the MIDDLE of an art run. Judged as-is, the fragment
    // falls under MIN_ANCHOR_GLYPHS, passes through as mascot, and the rows
    // after it anchor one row too low — so the banner is half-rewritten and
    // misaligned. Holding the fragment back lets the run reassemble against
    // the next read. Safe to delay: it is glyphs, never text being waited on.
    const tail = tokens[tokens.length - 1]
    if (tail?.kind === 'text' && isArtRun(tail.text) && tail.text.length <= GLYPH_CARRY_LIMIT) {
      tokens.pop()
      carry = tail.text + carry
    }

    let out = ''

    /** Emit the wordmark for the row being replaced and re-anchor the text. */
    function closeArt() {
      if (artRow === null) return
      const art = WORDMARK[artIndex].padEnd(ART_WIDTH)
      // ESC[49m before the art, then the run's own SGR replayed after it.
      //
      // 2.1.228's mascot has a black interior, painted as ESC[48;2;0;0;0m …
      // ESC[49m. The SET lands before the run anchors, so it is already in the
      // stream; the CLEAR lands inside the run. Dropping SGR within a run
      // therefore swallowed only the clear, and black bled across the wordmark,
      // the info text, and every later row until something else reset it.
      //
      // Replaying rather than discarding also keeps the info text in claude's
      // own colours, which is the entire reason this rewriter runs downstream
      // of claude instead of printing a banner of its own.
      out += `${ESC}[${artRow};${START_COL}H${ESC}[49m${art}${pendingSgr.join('')}${ESC}[${INFO_COL}G`
      pendingSgr = []
      row = artRow
      col = INFO_COL
      artRow = null
    }

    for (const token of tokens) {
      // --- inside a run of art: swallow everything that belongs to it -------
      if (artRow !== null) {
        if (token.kind === 'text') {
          if (isArtRun(token.text)) {
            col += token.text.length
            continue
          }
          closeArt()
        } else if (token.kind === 'csi') {
          const f = token.final
          // Cursor moves within the same row are the gaps BETWEEN art runs
          // (▘▘ ESC[1C ▝▝) — those go.
          if (f === 'C' || f === 'D' || f === 'G') {
            continue
          }
          if (f === 'H' || f === 'f') {
            if (param(token.params, 0, 1) === artRow) continue
            closeArt()
          } else if (f === 'm') {
            // The mascot's own colours — HELD, not dropped. See closeArt.
            pendingSgr.push(token.text)
            continue
          } else if (f === 'K') {
            continue
          } else {
            closeArt()
          }
        } else {
          closeArt()
        }
      }

      // --- ordinary tracking ------------------------------------------------
      if (token.kind === 'text') {
        const isArt = isArtRun(token.text)
        if (isArt && !done) {
          let index: number | null = null
          if (!anchored) {
            if (glyphCount(token.text) >= MIN_ANCHOR_GLYPHS) {
              anchored = true
              baseRow = row
              index = 0
            }
          } else if (baseRow !== null) {
            const candidate = row - baseRow
            if (candidate >= 0 && candidate < WORDMARK.length) index = candidate
          }

          if (index !== null) {
            artRow = row
            artIndex = index
            col += token.text.length
            continue
          }
        }
        out += token.text
        col += token.text.length
        continue
      }

      if (token.kind === 'cr') {
        col = 1
        out += token.text
        continue
      }
      if (token.kind === 'lf') {
        row += 1
        out += token.text
        continue
      }

      if (token.kind === 'csi') {
        switch (token.final) {
          case 'H':
          case 'f':
            row = param(token.params, 0, 1)
            col = param(token.params, 1, 1)
            break
          case 'G':
            col = param(token.params, 0, 1)
            break
          case 'C':
            col += param(token.params, 0, 1)
            break
          case 'D':
            col = Math.max(1, col - param(token.params, 0, 1))
            break
          case 'A':
            row = Math.max(1, row - param(token.params, 0, 1))
            break
          case 'B':
            row += param(token.params, 0, 1)
            break
        }
      }

      out += token.text
    }

    // Deliberately NOT flushed here. A chunk can end mid-art (the real stream
    // splits inside the banner), and `artRow` survives into the next call so
    // the run closes where it actually ends. Flushing instead would emit the
    // wordmark and re-anchor the column, and then the cursor-forward that
    // opens the next chunk would push that row's text out of line with the
    // others. Worst case the row stays blank until the next read arrives.
    return out
  }
}
