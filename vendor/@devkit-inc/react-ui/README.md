# @devkit-inc/react-ui

Shared React UI for the second-brain apps and the desktop shells — the renderer-side
half of `@devkit-inc/electron-ui`.

## What's inside

**Desktop chrome** (`src/shell/`) — the window furniture every shell renders:

- `AppBar` — the frameless title bar: window glyphs, overflow menu, theme picker, zoom indicator
- `BreadcrumbNav`, `OverflowMenu`, `ThemePicker`, `ThemeToggle`, `ZoomIndicator`, `VisualZoomViewport`
- Window glyphs: `MaximizeGlyph`, `RestoreGlyph`, `FullscreenGlyph`, `CheckGlyph`
- Hooks: `useFullscreen`, `useMaximized`, `useZoomFactor`, `useThemeRegistry`, `useDismiss`
- Stylesheets: `appbar.css`, `scroll.css`, `console.css` (imported from the package root)

**Components**

- `SchemaExplorer` / `SchemaExplorerPanel` — interactive ReactFlow canvas for visualizing database schemas
- `ConsolePane` — ANSI-rendering output pane, with `parseAnsi`
- `Calendar`
- `ThemeProvider` / `useTheme` — dark/light theme context
- `createUseIcon` — factory for fetching app icons from sbrain_assets
- Schema hooks: `useSchemaData`, `useColumns`
- Layout utilities: `computeLayout`, `getSchemaColor`

## Usage

```ts
import { AppBar, SchemaExplorer, ThemeProvider } from '@devkit-inc/react-ui'
import '@devkit-inc/react-ui/appbar.css'
```

## Themes

VSCode-style named themes for the desktop shells. A theme is **data**, not a CSS
block: `{ id, label, type: 'light' | 'dark', colors }`, where `colors` is a
*partial* override over the base palette for its `type`. Partial is the whole
point — a new theme is ~10 lines, and adding a token later does not mean editing
every theme.

```ts
const monokai: ThemeDef = {
  id: 'monokai', label: 'Monokai', type: 'dark',
  colors: { '--ds-bg': '#272822', '--ds-accent': '#a6e22e' },
  //        everything unset falls through to BASE.dark
}
```

**Adoption is automatic.** `AppBar` calls `useThemeRegistry(bridge?.theme)`
itself, so any app already rendering `<AppBar bridge={window.<app>} />` gets the
⋯ → Theme picker with no change. Pass `manageTheme={false}` to opt out (an app
whose pixels live in a `<webview>` guest should).

**Where themes come from.** Six built-ins compile into this package and are the
offline floor. `sbrain_config.themes` in masautt-db adds to and overrides them by
id — a remote row reusing a built-in id retunes it without a release, and a
tombstone can hide a remote theme but never delete a built-in. The main process
does the fetching (`registerTheme` in `@devkit-inc/electron-ui`); the service-role
key never reaches the renderer.

**The token contract** lives in `@devkit-inc/theme-tokens` — extracted from this package so
`@sbrain-inc/comp-runtime` can consume it without depending on react-ui across the
module-federation boundary. It has four groups:
chrome (`--ds-bg`, `--ds-surface`, …), semantic (`--ds-ok-fg`, `--ds-err-bg`, …),
a decorative 11-hue ramp (`--ds-hue-green-bg`, …), and terminal (`--ansi-*`).
Apps alias their own names onto it and keep the old literal as the `var()`
fallback, so a first paint or an older react-ui degrades to previous appearance:

```css
--t-green-bg: var(--ds-hue-green-bg, #052e16);
```

**Applying a theme sets four things at once** (`applyResolvedTheme`):
`data-theme` (the type — every `[data-theme='light']` rule keeps working),
`data-theme-id`, the `.dark` class (what `useDarkClass`, `ThemeProvider` and
`console.css` read), and `color-scheme` (native controls and scrollbars). They
used to be set in different places and could disagree.

**Contrast is enforced, not advisory.** `themes.test.ts` holds every built-in to
7:1 body text and 4.5:1 for muted, accent and each semantic pair. Several
published palettes fail as UI text at 12px — Nord's `nord3` is 2.4:1, Dracula's
`#6272a4` is 3.1:1 — so those are bumped with the published value noted. A new
theme may not be added to the grandfathered-waiver list; fix the color instead.

## Build

```sh
npm run build
```
