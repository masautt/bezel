// src/base.ts
var darkHues = {
  green: ["#052e16", "#86efac", "#052e16"],
  orange: ["#431407", "#fed7aa", "#431407"],
  purple: ["#2d1b69", "#c4b5fd", "#2d1b69"],
  blue: ["#0c1a2e", "#93c5fd", "#0c1a2e"],
  gray: ["#1f2937", "#9ca3af", "#1f2937"],
  indigo: ["#1e1b4b", "#a5b4fc", "#1e1b4b"],
  violet: ["#3b0764", "#e9d5ff", "#3b0764"],
  lime: ["#1a2e05", "#bef264", "#1a2e05"],
  cyan: ["#0d2a52", "#79c0ff", "#0d2a52"],
  amber: ["#3a2d0f", "#fde68a", "#3a2d0f"],
  red: ["#3b1d1d", "#fca5a5", "#3b1d1d"]
};
var lightHues = {
  green: ["#dafbe1", "#1a7f37", "#1f883d"],
  orange: ["#fff1e5", "#bc4c00", "#bc4c00"],
  purple: ["#fbefff", "#8250df", "#8250df"],
  blue: ["#ddf4ff", "#0969da", "#0969da"],
  gray: ["#eaeef2", "#59636e", "#6e7781"],
  indigo: ["#e6e9ff", "#4f46e5", "#4f46e5"],
  violet: ["#f3e8ff", "#9333ea", "#9333ea"],
  lime: ["#eef7d6", "#4d7c0f", "#5e8c12"],
  cyan: ["#ddf4ff", "#0969da", "#0969da"],
  amber: ["#fff8c5", "#9a6700", "#9a6700"],
  red: ["#ffebe9", "#cf222e", "#cf222e"]
};
var hueTokens = (hues) => Object.fromEntries(
  Object.entries(hues).flatMap(([h, [bg, fg, solid]]) => [
    [`--ds-hue-${h}-bg`, bg],
    [`--ds-hue-${h}-fg`, fg],
    [`--ds-hue-${h}-solid`, solid]
  ])
);
var DARK = {
  "--ds-bg": "#0d1117",
  "--ds-surface": "#161b22",
  "--ds-border": "#30363d",
  "--ds-border-dim": "#21262d",
  "--ds-text": "#e6edf3",
  "--ds-muted": "#8b949e",
  "--ds-accent": "#58a6ff",
  // Dedicated thumb tints, matched to the sbrain federation's measured contrast
  // (1.70:1 rest / 2.30:1 hover) so both ecosystems show one scrollbar
  // brightness on one screen. --ds-border-dim is a divider tint, not a thumb.
  "--ds-scroll-thumb": "#363c44",
  "--ds-scroll-thumb-hover": "#484f5c",
  "--ds-ok-bg": "#0f2e1a",
  "--ds-ok-fg": "#7ee787",
  "--ds-warn-bg": "#3a2d0f",
  "--ds-warn-fg": "#fde68a",
  "--ds-err-bg": "#3d1518",
  "--ds-err-fg": "#ff9492",
  "--ds-danger-bg": "#7f1d1d",
  "--ds-danger-fg": "#fecaca",
  "--ds-sel-bg": "#0d2a52",
  "--ds-sel-fg": "#79c0ff",
  "--ds-card-shadow": "rgba(0, 0, 0, 0.4)",
  ...hueTokens(darkHues),
  // Windows Terminal Campbell, using the BRIGHT variants for the slots the CLI
  // emits (stock red #C50F1F measures ~2.1:1 on #0C0C0C) and gray lightened
  // from #767676 to #8A8A8A. console.test.mjs is the authority on these.
  "--ansi-bg": "#0c0c0c",
  "--ansi-fg": "#cccccc",
  "--ansi-black": "#767676",
  "--ansi-red": "#e74856",
  "--ansi-green": "#16c60c",
  "--ansi-yellow": "#f9f1a5",
  "--ansi-blue": "#3b78ff",
  "--ansi-magenta": "#b4009e",
  "--ansi-cyan": "#61d6d6",
  "--ansi-white": "#cccccc",
  "--ansi-bright-black": "#8a8a8a",
  "--ansi-bright-red": "#e74856",
  "--ansi-bright-green": "#16c60c",
  "--ansi-bright-yellow": "#f9f1a5",
  "--ansi-bright-blue": "#3b78ff",
  "--ansi-bright-magenta": "#b4009e",
  "--ansi-bright-cyan": "#61d6d6",
  "--ansi-bright-white": "#f2f2f2"
};
var LIGHT = {
  "--ds-bg": "#ffffff",
  "--ds-surface": "#f6f8fa",
  "--ds-border": "#d1d9e0",
  "--ds-border-dim": "#eaeef2",
  "--ds-text": "#1f2328",
  "--ds-muted": "#59636e",
  "--ds-accent": "#0969da",
  "--ds-scroll-thumb": "#e1e4e8",
  "--ds-scroll-thumb-hover": "#ccd4dc",
  "--ds-ok-bg": "#dafbe1",
  "--ds-ok-fg": "#1a7f37",
  "--ds-warn-bg": "#fff8c5",
  "--ds-warn-fg": "#9a6700",
  "--ds-err-bg": "#ffebe9",
  "--ds-err-fg": "#cf222e",
  "--ds-danger-bg": "#ffd8d3",
  "--ds-danger-fg": "#cf222e",
  "--ds-sel-bg": "#ddf4ff",
  "--ds-sel-fg": "#0969da",
  "--ds-card-shadow": "rgba(31, 35, 40, 0.12)",
  ...hueTokens(lightHues),
  // One Half Light, darkened toward 700-weight equivalents where a stock value
  // could not clear its contrast floor on #fafafa.
  "--ansi-bg": "#fafafa",
  "--ansi-fg": "#383a42",
  "--ansi-black": "#383a42",
  "--ansi-red": "#b91c1c",
  "--ansi-green": "#15803d",
  "--ansi-yellow": "#a16207",
  "--ansi-blue": "#0184bc",
  "--ansi-magenta": "#a626a4",
  "--ansi-cyan": "#0e7490",
  "--ansi-white": "#4f525d",
  "--ansi-bright-black": "#4b5563",
  "--ansi-bright-red": "#b91c1c",
  "--ansi-bright-green": "#15803d",
  "--ansi-bright-yellow": "#a16207",
  "--ansi-bright-blue": "#0184bc",
  "--ansi-bright-magenta": "#a626a4",
  "--ansi-bright-cyan": "#0e7490",
  "--ansi-bright-white": "#383a42"
};
var BASE = { light: LIGHT, dark: DARK };

// src/tokens.ts
var CHROME_TOKENS = [
  "--ds-bg",
  "--ds-surface",
  "--ds-border",
  "--ds-border-dim",
  "--ds-text",
  "--ds-muted",
  "--ds-accent",
  "--ds-scroll-thumb",
  "--ds-scroll-thumb-hover",
  /* The AppBar wordmark. Per-app today (masaudit blue, localhub orange) and it
     stays that way — a theme that sets it is overriding the app's identity, so
     the base leaves it unset and .ds-appbar-brand keeps falling back to muted. */
  "--ds-brand"
];
var SEMANTIC_TOKENS = [
  "--ds-ok-bg",
  "--ds-ok-fg",
  "--ds-warn-bg",
  "--ds-warn-fg",
  "--ds-err-bg",
  "--ds-err-fg",
  "--ds-danger-bg",
  "--ds-danger-fg",
  "--ds-sel-bg",
  "--ds-sel-fg",
  "--ds-card-shadow"
];
var HUE_NAMES = [
  "green",
  "orange",
  "purple",
  "blue",
  "gray",
  "indigo",
  "violet",
  "lime",
  "cyan",
  "amber",
  "red"
];
var HUE_TOKENS = HUE_NAMES.flatMap(
  (h) => [`--ds-hue-${h}-bg`, `--ds-hue-${h}-fg`, `--ds-hue-${h}-solid`]
);
var ANSI_TOKENS = [
  "--ansi-bg",
  "--ansi-fg",
  "--ansi-black",
  "--ansi-red",
  "--ansi-green",
  "--ansi-yellow",
  "--ansi-blue",
  "--ansi-magenta",
  "--ansi-cyan",
  "--ansi-white",
  "--ansi-bright-black",
  "--ansi-bright-red",
  "--ansi-bright-green",
  "--ansi-bright-yellow",
  "--ansi-bright-blue",
  "--ansi-bright-magenta",
  "--ansi-bright-cyan",
  "--ansi-bright-white"
];
var ALL_TOKENS = [
  ...CHROME_TOKENS,
  ...SEMANTIC_TOKENS,
  ...HUE_TOKENS,
  ...ANSI_TOKENS
];
var TOKEN_SET = new Set(ALL_TOKENS);
function isThemeToken(name) {
  return TOKEN_SET.has(name);
}
var OPTIONAL_TOKENS = ["--ds-brand"];
export {
  ALL_TOKENS,
  ANSI_TOKENS,
  BASE,
  CHROME_TOKENS,
  HUE_NAMES,
  HUE_TOKENS,
  OPTIONAL_TOKENS,
  SEMANTIC_TOKENS,
  isThemeToken
};
//# sourceMappingURL=index.js.map