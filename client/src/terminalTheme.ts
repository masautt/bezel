import type { ITheme } from '@xterm/xterm'

/**
 * The xterm palette, read off CSS custom properties.
 *
 * WHY THIS EXISTS: an earlier version of this set four keys — background,
 * foreground, cursor, selectionBackground — and left the other sixteen to
 * xterm's built-in default, which is the Tango palette (`yellow #c4a000`,
 * `brightYellow #fce94f`) baked for a black background. Those sixteen are not
 * decoration: PSReadLine paints every command you type in `ESC[93m`
 * (brightYellow) and its prediction list in `ESC[33m` (yellow). Under the light
 * theme that put `#fce94f` on `#ffffff` — about 1.15:1 — so the terminals
 * visibly did not follow the theme the rest of the app did.
 *
 * The values come from @devkit-inc/react-ui's `--ansi-*` contract, NOT from a
 * second palette invented here. `ANSI_TOKENS` is part of `ALL_TOKENS`, so every
 * theme in the shared library carries its own terminal palette and
 * applyResolvedTheme writes it to <html> alongside the `--ds-*` chrome. Reading
 * those tokens is what makes the panes follow the PICKED theme rather than just
 * its light/dark type — and it is the same palette ConsolePane and the sbrain
 * comps render, so a terminal and a console pane on one screen agree.
 *
 * Re-deriving the colors here would also mean owning contrast nobody checks:
 * upstream's console.test.mjs enforces a floor per slot against `--ansi-bg`.
 */

/** xterm ITheme key -> the `--ansi-*` custom property that supplies it. */
const ANSI_SLOTS = {
  black: '--ansi-black',
  red: '--ansi-red',
  green: '--ansi-green',
  yellow: '--ansi-yellow',
  blue: '--ansi-blue',
  magenta: '--ansi-magenta',
  cyan: '--ansi-cyan',
  white: '--ansi-white',
  brightBlack: '--ansi-bright-black',
  brightRed: '--ansi-bright-red',
  brightGreen: '--ansi-bright-green',
  brightYellow: '--ansi-bright-yellow',
  brightBlue: '--ansi-bright-blue',
  brightMagenta: '--ansi-bright-magenta',
  brightCyan: '--ansi-bright-cyan',
  brightWhite: '--ansi-bright-white',
} as const satisfies Record<string, string>

/**
 * react-ui's own dark BASE palette verbatim, plus appbar.css's dark `--ds-*`.
 *
 * These cover exactly one case: the frame before useThemeRegistry's effect runs
 * applyResolvedTheme, on a machine with no cached first-paint CSS to replay.
 * Dark is the right value for it rather than an arbitrary one — that is what
 * every stylesheet here paints an unresolved theme as.
 */
const FALLBACK = {
  '--surface-canvas': '#0d1117',
  '--accent-fg': '#58a6ff',
  '--ansi-fg': '#cccccc',
  '--ansi-black': '#767676',
  '--ansi-red': '#e74856',
  '--ansi-green': '#16c60c',
  '--ansi-yellow': '#f9f1a5',
  '--ansi-blue': '#3b78ff',
  '--ansi-magenta': '#b4009e',
  '--ansi-cyan': '#61d6d6',
  '--ansi-white': '#cccccc',
  '--ansi-bright-black': '#8a8a8a',
  '--ansi-bright-red': '#e74856',
  '--ansi-bright-green': '#16c60c',
  '--ansi-bright-yellow': '#f9f1a5',
  '--ansi-bright-blue': '#3b78ff',
  '--ansi-bright-magenta': '#b4009e',
  '--ansi-bright-cyan': '#61d6d6',
  '--ansi-bright-white': '#f2f2f2',
} as const

/**
 * The <html> attributes a theme change can arrive on, for the pane's observer.
 *
 * `style` is the load-bearing one and the easy one to omit: applyResolvedTheme
 * writes the resolved tokens to the INLINE STYLE of <html> and derives
 * `data-theme`/`.dark` from the theme's TYPE alone, so a dark→dark switch moves
 * the palette without touching either attribute. Exported so that is a fact a
 * test can hold rather than a detail buried in an effect.
 */
export const THEME_ATTRIBUTES = ['style', 'data-theme-id', 'data-theme', 'class'] as const

export type CssVarReader = (name: string) => string

/**
 * Build the xterm theme from a custom-property reader.
 *
 * Split out of TerminalPane so it is testable without mounting xterm (which
 * wants a canvas jsdom does not have).
 */
export function terminalTheme(read: CssVarReader): ITheme {
  const v = (name: keyof typeof FALLBACK) => read(name).trim() || FALLBACK[name]

  // Built as its own object and spread in below: assigning through a
  // `keyof ITheme` index narrows the value type to `never` and does not
  // compile, and widening it with a cast would drop the check that every slot
  // name is a real ITheme key.
  const ansi = Object.fromEntries(
    Object.entries(ANSI_SLOTS).map(([slot, token]) => [slot, v(token as keyof typeof FALLBACK)])
  ) satisfies Record<string, string> as Record<keyof typeof ANSI_SLOTS, string>

  return {
    // Deliberately the app canvas, NOT --ansi-bg. The pane sits in 4-8px of
    // .center padding, so a terminal background even slightly off from the
    // chrome shows as a visible rectangle at the seam — `--ansi-bg` is #0c0c0c
    // (neutral) against the canvas's #0d1117 (blue-tinted). The contrast floors
    // upstream are measured against --ansi-bg, and this substitution does not
    // spend any of that margin: #0d1117 is fractionally DARKER than #0c0c0c is
    // not, and #ffffff is lighter than #fafafa, so every slot lands on a
    // background at least as favourable as the one it was checked against.
    background: v('--surface-canvas'),
    foreground: v('--ansi-fg'),
    cursor: v('--accent-fg'),
    // Selection was --ds-muted with no explicit foreground, which is #59636e in
    // the light theme — a dark slate block under #383a42 text. An accent fill
    // with the canvas as its foreground is legible in both themes; it does cost
    // the syntax colors inside the selection, which is the usual trade (VS
    // Code's terminal makes the same one).
    selectionBackground: v('--accent-fg'),
    selectionForeground: v('--surface-canvas'),
    ...ansi,
  }
}

/**
 * The reader for a live element.
 *
 * `getComputedStyle` is called per read rather than captured once: the whole
 * point of this reader is to be called again after the theme flips, and a
 * captured declaration is only live by grace of the engine.
 */
export function elementCssVars(el: Element): CssVarReader {
  return name => getComputedStyle(el).getPropertyValue(name)
}
