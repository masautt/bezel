/**
 * The theme value the panes' PROMPT reads, as opposed to the one the renderer
 * paints with.
 *
 * bezel themes its own chrome and its xterm palettes from the shared registry
 * (see client/src/terminalTheme.ts), but the prompt inside a pane is rendered by
 * oh-my-posh in another process, from the user's own config, and that config
 * carries absolute hex. Nothing the terminal palette does can reach it — a
 * segment with `"background": "#272727"` stays a dark block on a white theme.
 *
 * oh-my-posh's answer is `palettes`, whose `template` is evaluated on every
 * prompt render against the CURRENT environment. So the whole channel is one
 * environment variable, `BEZEL_THEME`, and this module is the small amount of
 * agreement the two ends need: what the legal values are, and how to quote a
 * path into the PowerShell snippet that reads it.
 *
 * Kept pure and IO-free, like config-patch.ts: main owns the reads and writes.
 */

/** Matches ThemeType in @devkit-inc/react-ui — the registry's `theme.type`. */
export type PaneTheme = 'light' | 'dark'

/**
 * What an unset, unreadable or unrecognized value means.
 *
 * Dark, because that is what every stylesheet here paints an unresolved theme
 * as, and because it is what oh-my-posh falls back to when BEZEL_THEME is
 * absent — which is the normal state in Windows Terminal, where the same config
 * is loaded and must keep looking exactly as it does today.
 */
export const DEFAULT_PANE_THEME: PaneTheme = 'dark'

/**
 * Narrow anything to a PaneTheme.
 *
 * The value crosses an IPC boundary and is then written to a file that a shell
 * interpolates into its environment, so it is normalized to one of two literals
 * here rather than trusted. Nothing else can reach the prompt through it.
 */
export function normalizePaneTheme(value: unknown): PaneTheme {
  return value === 'light' ? 'light' : DEFAULT_PANE_THEME
}

/**
 * Quote a string as a PowerShell SINGLE-quoted literal.
 *
 * Single-quoted is the point: PowerShell expands `$`, backticks and `"` inside
 * double quotes, and a Windows path is a plausible place for a `$` to appear.
 * Inside single quotes the only metacharacter left is the quote itself, escaped
 * by doubling.
 */
export function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
