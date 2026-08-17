/**
 * bezel's own marks: one icon per settings section, plus the full-screen glyph
 * that section uses.
 *
 * Drawn on a 16x16 grid rather than the 10x10 grid @devkit-inc/react-ui's
 * WindowGlyphs use. Those are window controls — a square, a chevron — and a
 * coarse grid keeps them crisp. These carry more detail (a disc split down the
 * middle, three columns inside a frame) and land on half-units at 10, where they
 * blur. Every icon here shares the 16 grid so they stay a set.
 *
 * All stroke, no fill, `currentColor` — so a button's `color` (and its :hover)
 * paints the icon with no per-icon theming, exactly like the react-ui glyphs.
 */
const ICON = {
  viewBox: '0 0 16 16',
  width: '14',
  height: '14',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** Layout. bezel's own shape: a center column between two gutters. */
export function LayoutGlyph() {
  return (
    <svg {...ICON} data-icon="layout">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M5.5 2.5V13.5M10.5 2.5V13.5" />
    </svg>
  )
}

/**
 * Appearance. The half-filled contrast disc, which is what a theme picker is
 * about — and the one icon here that needs a fill, since a light/dark split
 * cannot be drawn in outline.
 */
export function AppearanceGlyph() {
  return (
    <svg {...ICON} data-icon="appearance">
      <circle cx="8" cy="8" r="5.5" />
      {/* sweep-flag 0 from the top point to the bottom one goes counter-clockwise
          in SVG's y-down space, i.e. around the LEFT side — so this fills the
          left half and leaves the right half in outline. */}
      <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** About. */
export function InfoGlyph() {
  return (
    <svg {...ICON} data-icon="info">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.4V11.2" />
      {/* A filled dot, not a zero-length stroke: a stroke of length 0 renders
          only under `stroke-linecap: round` and disappears the moment someone
          changes the shared cap above. */}
      <circle cx="8" cy="4.9" r="0.65" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Full screen, mirroring react-ui's menu glyph at this file's size. */
export function ExpandGlyph() {
  return (
    <svg {...ICON} data-icon="expand">
      <path d="M1.6 5.6V1.6H5.6M10.4 1.6H14.4V5.6M14.4 10.4V14.4H10.4M5.6 14.4H1.6V10.4" />
    </svg>
  )
}
