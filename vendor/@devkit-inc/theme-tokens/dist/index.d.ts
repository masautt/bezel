/**
 * The theme token contract.
 *
 * Every name here is a CSS custom property a theme may set. This list is the
 * authority: `base.ts` must supply a value for all of them in both light and
 * dark (asserted by tokens.test.ts), and a ThemeDef may override any subset.
 *
 * Themes are PARTIAL by design — see `ThemeDef.colors`. A theme that had to
 * restate all ~80 tokens would make adding a token a rewrite of every theme,
 * which is exactly the failure mode the pre-registry CSS blocks had.
 *
 * Grouped, not flat, because the groups have different owners and different
 * rules: CHROME is the shell's own surface, SEMANTIC is meaning (ok/err/warn),
 * HUE is a decorative ramp with no fixed meaning, and ANSI is terminal output
 * whose values answer to console.test.mjs's contrast floors rather than to
 * taste.
 */
/** Shell chrome — the AppBar, crumbs, menus, panels, scrollbars. */
declare const CHROME_TOKENS: readonly ["--ds-bg", "--ds-surface", "--ds-border", "--ds-border-dim", "--ds-text", "--ds-muted", "--ds-accent", "--ds-scroll-thumb", "--ds-scroll-thumb-hover", "--ds-brand"];
/** Colors that carry meaning. A theme may restyle them but not repurpose them. */
declare const SEMANTIC_TOKENS: readonly ["--ds-ok-bg", "--ds-ok-fg", "--ds-warn-bg", "--ds-warn-fg", "--ds-err-bg", "--ds-err-fg", "--ds-danger-bg", "--ds-danger-fg", "--ds-sel-bg", "--ds-sel-fg", "--ds-card-shadow"];
/**
 * The decorative ramp, promoted from masaudit's `--t-*` block. Each hue has:
 *   -bg    fill behind a badge
 *   -fg    text on that fill
 *   -solid the saturated value used when the hue paints a bar or accent line
 *
 * In dark, -solid equals -bg (a saturated bar reads as a block on a dark
 * ground); in light they diverge. That asymmetry is inherited from masaudit's
 * hand-tuned values and is deliberate, not an oversight to normalize away.
 */
declare const HUE_NAMES: readonly ["green", "orange", "purple", "blue", "gray", "indigo", "violet", "lime", "cyan", "amber", "red"];
type HueName = (typeof HUE_NAMES)[number];
declare const HUE_TOKENS: ("--ds-hue-green-bg" | "--ds-hue-orange-bg" | "--ds-hue-purple-bg" | "--ds-hue-blue-bg" | "--ds-hue-gray-bg" | "--ds-hue-indigo-bg" | "--ds-hue-violet-bg" | "--ds-hue-lime-bg" | "--ds-hue-cyan-bg" | "--ds-hue-amber-bg" | "--ds-hue-red-bg" | "--ds-hue-green-fg" | "--ds-hue-orange-fg" | "--ds-hue-purple-fg" | "--ds-hue-blue-fg" | "--ds-hue-gray-fg" | "--ds-hue-indigo-fg" | "--ds-hue-violet-fg" | "--ds-hue-lime-fg" | "--ds-hue-cyan-fg" | "--ds-hue-amber-fg" | "--ds-hue-red-fg" | "--ds-hue-green-solid" | "--ds-hue-orange-solid" | "--ds-hue-purple-solid" | "--ds-hue-blue-solid" | "--ds-hue-gray-solid" | "--ds-hue-indigo-solid" | "--ds-hue-violet-solid" | "--ds-hue-lime-solid" | "--ds-hue-cyan-solid" | "--ds-hue-amber-solid" | "--ds-hue-red-solid")[];
/**
 * Terminal output. Mirrors console.css, which a theme inherits unless it ships
 * its own terminal palette (VSCode's `terminal.ansi*` keys do the same).
 *
 * These are the one group with an external referee: console.test.mjs enforces a
 * contrast floor for every slot against --ansi-bg. A theme that overrides them
 * is subject to the same check.
 */
declare const ANSI_TOKENS: readonly ["--ansi-bg", "--ansi-fg", "--ansi-black", "--ansi-red", "--ansi-green", "--ansi-yellow", "--ansi-blue", "--ansi-magenta", "--ansi-cyan", "--ansi-white", "--ansi-bright-black", "--ansi-bright-red", "--ansi-bright-green", "--ansi-bright-yellow", "--ansi-bright-blue", "--ansi-bright-magenta", "--ansi-bright-cyan", "--ansi-bright-white"];
/** Every token a theme may set, in group order. */
declare const ALL_TOKENS: readonly string[];
/** Is `name` part of the contract? Used to drop junk from remote rows. */
declare function isThemeToken(name: string): boolean;
/**
 * `--ds-brand` is the one token the base deliberately leaves unset, so it is
 * excluded from the "base must be complete" assertion. Kept next to the token
 * list rather than in the test so the reason lives with the contract.
 */
declare const OPTIONAL_TOKENS: readonly string[];
type TokenName = string;
/** A complete palette. */
type TokenMap = Record<TokenName, string>;
/** What a theme declares — only what it changes. */
type PartialTokenMap = Partial<TokenMap>;

declare const BASE: Readonly<Record<'light' | 'dark', TokenMap>>;

export { ALL_TOKENS, ANSI_TOKENS, BASE, CHROME_TOKENS, HUE_NAMES, HUE_TOKENS, type HueName, OPTIONAL_TOKENS, type PartialTokenMap, SEMANTIC_TOKENS, type TokenMap, type TokenName, isThemeToken };
