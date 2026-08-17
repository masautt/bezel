import { describe, it, expect } from 'vitest'
import { terminalTheme, elementCssVars, THEME_ATTRIBUTES } from '../client/src/terminalTheme'

/**
 * The regression these guard is a SILENT one: xterm accepts a theme object with
 * four keys and quietly fills the other sixteen from its own Tango default, so
 * nothing errors and nothing logs — the terminals just stop following the theme.
 * PSReadLine's `ESC[93m` command color on the light theme's white background is
 * what made it visible.
 */

/** Every ANSI slot xterm reads, and so every one this app must supply. */
const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const

/** A reader over a plain map, standing in for getComputedStyle. */
const reader = (vars: Record<string, string>) => (name: string) => vars[name] ?? ''

describe('terminalTheme', () => {
  it('supplies all sixteen ANSI slots, not just fg/bg/cursor/selection', () => {
    const theme = terminalTheme(reader({}))
    for (const key of ANSI_KEYS) {
      expect(theme[key], `missing ANSI slot: ${key}`).toBeTruthy()
    }
  })

  it('sources every ANSI slot from its --ansi-* token', () => {
    // Distinct sentinels so a mis-wired slot (e.g. brightYellow reading
    // --ansi-yellow) fails instead of coincidentally matching.
    const vars = Object.fromEntries(
      ANSI_KEYS.map((key, i) => [
        '--ansi-' + key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
        `#0000${String(i).padStart(2, '0')}`,
      ])
    )
    const theme = terminalTheme(reader(vars))
    ANSI_KEYS.forEach((key, i) => {
      expect(theme[key], `wrong token feeding ${key}`).toBe(`#0000${String(i).padStart(2, '0')}`)
    })
  })

  it('follows the light palette when the tokens resolve light', () => {
    // The exact values react-ui's light BASE publishes. The point of the
    // assertion is the yellow: #a16207 clears its floor on white, #fce94f
    // (xterm's default, ~1.15:1) is the bug.
    const theme = terminalTheme(reader({
      '--surface-canvas': '#ffffff',
      '--ansi-fg': '#383a42',
      '--ansi-yellow': '#a16207',
      '--ansi-bright-yellow': '#a16207',
    }))
    expect(theme.background).toBe('#ffffff')
    expect(theme.foreground).toBe('#383a42')
    expect(theme.yellow).toBe('#a16207')
    expect(theme.brightYellow).toBe('#a16207')
  })

  it('keeps the terminal background on the app canvas, not --ansi-bg', () => {
    // The panes sit inside .center's padding; an --ansi-bg terminal would show
    // as a differently-tinted rectangle at the seam. If this is ever changed
    // deliberately, this test is the record of what it costs.
    const theme = terminalTheme(reader({ '--surface-canvas': '#0d1117', '--ansi-bg': '#0c0c0c' }))
    expect(theme.background).toBe('#0d1117')
  })

  it('gives selection an explicit foreground', () => {
    // A selection background with no foreground was legible in dark and not in
    // light, which is exactly the failure mode this whole change is about.
    const theme = terminalTheme(reader({ '--accent-fg': '#0969da', '--surface-canvas': '#ffffff' }))
    expect(theme.selectionBackground).toBe('#0969da')
    expect(theme.selectionForeground).toBe('#ffffff')
  })

  it('falls back to the dark palette when nothing resolves', () => {
    // Not an arbitrary default: this is the frame before the registry applies
    // a theme, and every stylesheet here paints an unresolved theme as dark.
    const theme = terminalTheme(reader({}))
    expect(theme.background).toBe('#0d1117')
    expect(theme.brightYellow).toBe('#f9f1a5')
  })

  it('trims whatever getPropertyValue hands back', () => {
    // getComputedStyle().getPropertyValue() preserves the leading space in
    // `--ansi-red: #b91c1c` as authored. An untrimmed value is not a valid
    // xterm color and is dropped silently.
    const theme = terminalTheme(reader({ '--ansi-red': '  #b91c1c ' }))
    expect(theme.red).toBe('#b91c1c')
  })

  it('reads live values through elementCssVars after a re-theme', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const read = elementCssVars(el)
    el.style.setProperty('--ansi-red', '#111111')
    expect(read('--ansi-red')).toBe('#111111')
    // The reader must not have captured a stale declaration.
    el.style.setProperty('--ansi-red', '#222222')
    expect(read('--ansi-red')).toBe('#222222')
    el.remove()
  })
})

describe('THEME_ATTRIBUTES', () => {
  it('includes style, or a dark→dark theme switch is missed entirely', () => {
    // applyResolvedTheme writes the resolved tokens to <html>'s inline style and
    // sets data-theme/.dark from the theme TYPE. Two dark themes share a type,
    // so `style` is the only signal that separates them. Dropping it from the
    // observer leaves the panes on the outgoing palette with nothing to show
    // for it — no error, no log.
    expect(THEME_ATTRIBUTES).toContain('style')
  })

  it('still covers the type-level attributes', () => {
    expect(THEME_ATTRIBUTES).toContain('data-theme')
    expect(THEME_ATTRIBUTES).toContain('class')
  })
})
