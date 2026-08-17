import { describe, it, expect } from 'vitest'
import { createBannerRewriter } from '@shared/banner'

const ESC = String.fromCharCode(27)

/**
 * The banner exactly as a real `claude` painted it into a pty on 2026-08-09,
 * captured with node-pty at 100x30. Not hand-written: the escape choreography
 * here (CUP placement, cursor-forward gaps between WORDS, two art runs on the
 * last row, one "line" holding two art rows) is the whole reason this module
 * tracks the cursor instead of matching lines, so the fixture has to be real.
 */
const BANNER =
  `${ESC}[2;2H▐▛███▜▌${ESC}[3CClaude${ESC}[1CCode${ESC}[1Cv2.1.226\r\n` +
  `▝▜█████▛▘${ESC}[2COpus${ESC}[1C5${ESC}[1C(1M${ESC}[1Ccontext)${ESC}[1Cwith` +
  `${ESC}[1Cmedium${ESC}[1Ceffort${ESC}[1C·${ESC}[1CClaude${ESC}[1CMax` +
  `${ESC}[4;3H▘▘${ESC}[1C▝▝${ESC}[4C~\\source`

/**
 * The same banner as painted by claude 2.1.228, captured the same way on
 * 2026-08-11. Kept ALONGSIDE the 2.1.226 fixture rather than replacing it:
 * both are real, and the rewriter has to survive whichever one a given machine
 * happens to be running.
 *
 * Three things changed, and each one defeated a separate assumption:
 *   - the mascot now has a BLACK INTERIOR, so art runs are interleaved with
 *     SGR background set/reset (ESC[48;2;0;0;0m … ESC[49m);
 *   - runs carry leading/trailing SPACES (" ▐", "  ▘▘ ▝▝  "), so a whole-token
 *     glyph match no longer fires;
 *   - the third row is plain spaced text, not CUP plus two glyph runs.
 */
const BANNER_228 =
  `${ESC}[38;2;215;119;87m${ESC}[2;1H ▐${ESC}[48;2;0;0;0m▛███▜${ESC}[49m▌${ESC}[m${ESC}[1m` +
  `${ESC}[3CClaude Code${ESC}[38;2;153;153;153m${ESC}[22m${ESC}[1Cv2.1.228` +
  `${ESC}[38;2;215;119;87m\r\n▝▜${ESC}[48;2;0;0;0m█████${ESC}[49m▛▘` +
  `${ESC}[38;2;153;153;153m${ESC}[2COpus 5 (1M context) with medium effort · Claude Max` +
  `${ESC}[38;2;215;119;87m\r\n  ▘▘ ▝▝  ${ESC}[38;2;153;153;153m${ESC}[2C~\\source` +
  `${ESC}[38;2;255;193;7m${ESC}[6;2H⚠${ESC}[1CYour login expires in 3 days ` +
  `${ESC}[38;2;153;153;153m· run /login to renew`

const MASCOT = /[▀▄█▌▐▖-▟]/

// Built from ESC rather than written as a literal: a raw control character in
// a regex literal trips no-control-regex.
const CSI_RE = new RegExp(`^${ESC}\\[([0-9;:?<>=!]*)([@-~])`)

/**
 * Paint a stream onto a grid and read the rows back. Asserting on what the
 * terminal SHOWS is the only assertion that means anything here — the bytes
 * are absolute moves, so byte-level checks would pass while the screen was
 * still wrong.
 */
function render(stream: string, rows = 8, cols = 100): string[] {
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(' '))
  let row = 1
  let col = 1
  let i = 0

  const num = (s: string, fallback: number) => (s === '' ? fallback : Number(s))

  while (i < stream.length) {
    const ch = stream[i]
    if (ch === '\r') {
      col = 1
      i += 1
    } else if (ch === '\n') {
      row += 1
      i += 1
    } else if (ch === ESC && stream[i + 1] === '[') {
      const m = CSI_RE.exec(stream.slice(i))!
      const [p1 = '', p2 = ''] = m[1].split(';')
      if (m[2] === 'H' || m[2] === 'f') {
        row = num(p1, 1)
        col = num(p2, 1)
      } else if (m[2] === 'G') col = num(p1, 1)
      else if (m[2] === 'C') col += num(p1, 1)
      else if (m[2] === 'D') col = Math.max(1, col - num(p1, 1))
      i += m[0].length
    } else {
      if (row <= rows && col <= cols) grid[row - 1][col - 1] = ch
      col += 1
      i += 1
    }
  }
  return grid.map(r => r.join('').replace(/\s+$/, ''))
}

/**
 * Every printed cell, with whether a non-default BACKGROUND was active when it
 * was painted. `render` above deliberately ignores colour, which is exactly why
 * it reported a clean screen while the real terminal showed black rectangles —
 * so the background needs its own model, not a sharper eye on the same one.
 */
function renderBg(stream: string): Array<{ row: number; col: number; ch: string; bg: boolean }> {
  const cells: Array<{ row: number; col: number; ch: string; bg: boolean }> = []
  let row = 1
  let col = 1
  let i = 0
  let bg = false
  const num = (s: string, fallback: number) => (s === '' ? fallback : Number(s))

  while (i < stream.length) {
    const ch = stream[i]
    if (ch === '\r') { col = 1; i += 1 }
    else if (ch === '\n') { row += 1; i += 1 }
    else if (ch === ESC && stream[i + 1] === '[') {
      const m = CSI_RE.exec(stream.slice(i))!
      const [p1 = '', p2 = ''] = m[1].split(';')
      if (m[2] === 'H' || m[2] === 'f') { row = num(p1, 1); col = num(p2, 1) }
      else if (m[2] === 'G') col = num(p1, 1)
      else if (m[2] === 'C') col += num(p1, 1)
      else if (m[2] === 'D') col = Math.max(1, col - num(p1, 1))
      // 48 sets a background, 49 restores the default, and a bare/0 SGR resets
      // everything — the three the banner actually uses.
      else if (m[2] === 'm') {
        const first = num(p1, 0)
        if (first === 48) bg = true
        else if (first === 49 || first === 0) bg = false
      }
      i += m[0].length
    } else {
      if (ch !== ' ') cells.push({ row, col, ch, bg })
      col += 1
      i += 1
    }
  }
  return cells
}

describe('createBannerRewriter', () => {
  it('paints the wordmark where the mascot was, with the info text intact', () => {
    const screen = render(createBannerRewriter()(BANNER))
    expect(screen[1]).toBe(' ╔╗ ╔═╗╔═╗╔═╗╦     Claude Code v2.1.226')
    expect(screen[2]).toBe(' ╠╩╗║╣ ╔═╝║╣ ║     Opus 5 (1M context) with medium effort · Claude Max')
    expect(screen[3]).toBe(' ╚═╝╚═╝╚═╝╚═╝╩═╝   ~\\source')
  })

  it('leaves no mascot glyph anywhere on screen', () => {
    expect(render(createBannerRewriter()(BANNER)).join('\n')).not.toMatch(MASCOT)
  })

  it('lands all three info rows on one column', () => {
    const screen = render(createBannerRewriter()(BANNER))
    const cols = [
      screen[1].indexOf('Claude Code'),
      screen[2].indexOf('Opus 5'),
      screen[3].indexOf('~\\source'),
    ]
    expect(new Set(cols).size).toBe(1)
  })

  it('survives the banner being split across pty reads, at every offset', () => {
    for (let cut = 1; cut < BANNER.length; cut++) {
      const rewrite = createBannerRewriter()
      const out = rewrite(BANNER.slice(0, cut)) + rewrite(BANNER.slice(cut))
      const screen = render(out)
      expect(screen.join('\n'), `split at ${cut}`).not.toMatch(MASCOT)
      expect(screen[1], `split at ${cut}`).toContain('Claude Code v2.1.226')
      expect(screen[3], `split at ${cut}`).toContain('~\\source')
    }
  })

  it('handles every mascot variant, not just the default art', () => {
    // r1E/r2L differ per variant; look-left, look-right and arms-up all use
    // glyphs the default art never contains.
    for (const top of ['▐▛███▜▌', '▐▟███▟▌', '▐▙███▙▌', '▗▟▛███▜▙▖']) {
      const out = createBannerRewriter()(`${ESC}[2;2H${top}${ESC}[3CClaude${ESC}[1CCode`)
      const screen = render(out)
      expect(screen.join('\n')).not.toMatch(MASCOT)
      expect(screen[1]).toContain('╔╗ ╔═╗╔═╗╔═╗╦')
      expect(screen[1]).toContain('Claude')
    }
  })

  it('drops the colour spans Ink interleaves through the art', () => {
    const colored = `${ESC}[2;2H${ESC}[38;5;208m▐▛███${ESC}[39m▜▌${ESC}[3CClaude`
    const screen = render(createBannerRewriter()(colored))
    expect(screen.join('\n')).not.toMatch(MASCOT)
    expect(screen[1]).toContain('Claude')
  })

  it('parses the OSC title that arrives immediately before the banner', () => {
    const withTitle = `${ESC}]0;✳ Claude Code${String.fromCharCode(7)}${BANNER}`
    const screen = render(createBannerRewriter()(withTitle))
    expect(screen[1]).toContain('╔╗ ╔═╗╔═╗╔═╗╦')
    expect(screen[1]).toContain('Claude Code v2.1.226')
  })

  it('passes ordinary output through byte for byte', () => {
    const rewrite = createBannerRewriter()
    const text = 'PS C:\\Users\\testuser\\source> git status\r\nOn branch main\r\n'
    expect(rewrite(text)).toBe(text)
  })

  it('does not mangle block-glyph output once the banner has been found', () => {
    const rewrite = createBannerRewriter()
    rewrite(BANNER)
    const chart = `${ESC}[10;1Hlatency ████████░░ 80%`
    expect(rewrite(chart)).toBe(chart)
  })

  it('still rewrites the banner when Claude repaints it in place', () => {
    const rewrite = createBannerRewriter()
    rewrite(BANNER)
    const screen = render(rewrite(BANNER))
    expect(screen.join('\n')).not.toMatch(MASCOT)
    expect(screen[1]).toContain('╔╗ ╔═╗╔═╗╔═╗╦')
  })

  it('stops looking once the banner can no longer be ahead', () => {
    const rewrite = createBannerRewriter()
    rewrite('x'.repeat(300 * 1024))
    expect(rewrite(BANNER)).toBe(BANNER)
  })

  describe('claude 2.1.228 (black-interior mascot, spaced art rows)', () => {
    it('paints all three wordmark rows and re-anchors all three info rows', () => {
      const screen = render(createBannerRewriter()(BANNER_228))
      expect(screen.join('\n')).not.toMatch(MASCOT)
      expect(screen[1]).toBe(' ╔╗ ╔═╗╔═╗╔═╗╦     Claude Code v2.1.228')
      expect(screen[2]).toBe(' ╠╩╗║╣ ╔═╝║╣ ║     Opus 5 (1M context) with medium effort · Claude Max')
      // The row that regressed: its art arrives as one spaced text token, so a
      // whole-token glyph match skipped it — leaving raw feet and ~\source
      // hanging six columns left of the rows above it.
      expect(screen[3]).toBe(' ╚═╝╚═╝╚═╝╚═╝╩═╝   ~\\source')
    })

    it('leaves no background colour switched on behind the banner', () => {
      // The mascot's black interior is set BEFORE an art run and cleared INSIDE
      // it. Dropping SGR within a run swallowed only the clear, so black bled
      // across the wordmark, the info text and everything painted after it.
      const cells = renderBg(createBannerRewriter()(BANNER_228))
      const bled = cells.filter(c => c.bg).map(c => `${c.row}:${c.col} ${JSON.stringify(c.ch)}`)
      expect(bled).toEqual([])
    })

    it('keeps the info text in the colours claude chose', () => {
      // Balancing the background must not be done by flattening every SGR: the
      // version, model line and warning are all differently coloured, and the
      // whole point of rewriting downstream is to leave that text untouched.
      const out = createBannerRewriter()(BANNER_228)
      expect(out).toContain(`${ESC}[38;2;153;153;153m`) // grey info text
      expect(out).toContain(`${ESC}[38;2;255;193;7m`) // amber login warning
    })
  })
})
