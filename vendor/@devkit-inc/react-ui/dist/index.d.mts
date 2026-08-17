import { SupabaseClient } from '@supabase/supabase-js';
import * as react from 'react';
import { ReactNode, RefObject } from 'react';
import { Node, Edge } from '@xyflow/react';
import { PartialTokenMap, TokenMap } from '@devkit-inc/theme-tokens';
export { ALL_TOKENS, ANSI_TOKENS, BASE, CHROME_TOKENS, HUE_NAMES, HUE_TOKENS, HueName, OPTIONAL_TOKENS, PartialTokenMap, SEMANTIC_TOKENS, TokenMap, TokenName, isThemeToken } from '@devkit-inc/theme-tokens';

declare function createUseIcon(supabase: SupabaseClient, appName: string): (style?: "a" | "b") => string | null;

interface RpcClient {
    rpc(fn: string, params?: Record<string, unknown>): PromiseLike<{
        data: unknown;
        error: {
            message: string;
        } | null;
    }>;
}
interface SchemaTable {
    schema: string;
    name: string;
    type: string;
}
interface SchemaColumn {
    name: string;
    dataType: string;
    isNullable: boolean;
    columnDefault: string | null;
}
interface ForeignKey {
    fromSchema: string;
    fromTable: string;
    fromColumn: string;
    toSchema: string;
    toTable: string;
    toColumn: string;
}

declare function useSchemaData(supabase: RpcClient, schemaPrefix: string): {
    tables: SchemaTable[];
    foreignKeys: ForeignKey[];
    loading: boolean;
    error: string | null;
};

declare function useColumns(supabase: RpcClient, schemaPrefix: string, schema: string | null, table: string | null): {
    columns: SchemaColumn[];
    loading: boolean;
};

/**
 * The current theme from the host `.dark` class on <html>, reactively. This is the
 * sbrain comp standard (no per-comp provider — read the host class). Re-renders when
 * the class toggles.
 *
 * useSyncExternalStore rather than useState + useEffect: the class can flip between
 * the first read and the MutationObserver attaching, and nothing re-reads on its own,
 * so a hook that trusts its first read reports the stale theme forever. Resyncing by
 * calling setState inside the effect closes that window but cascades a second render
 * on every mount. React re-reads the snapshot after subscribing for exactly this
 * reason, so the race is handled without the extra render.
 */
declare function useDarkClass(): 'light' | 'dark';

interface Props$5 {
    supabase: RpcClient;
    schemaPrefix: string;
    hiddenByDefault?: string[];
}
declare function SchemaExplorer({ supabase, schemaPrefix, hiddenByDefault }: Props$5): react.JSX.Element;

interface Props$4 {
    supabase: RpcClient;
    schemaPrefix: string;
    hiddenByDefault?: string[];
}
/**
 * The reusable "schema admin view". SchemaExplorer's root is flex:1, so it only
 * fills when its parent is a flex container — this panel is that container, so
 * every admin can drop it in without re-learning the sizing rule. Place the panel
 * itself as a flex child of a region with a real height (a `flex-1` admin body).
 */
declare function SchemaExplorerPanel({ supabase, schemaPrefix, hiddenByDefault }: Props$4): react.JSX.Element;

interface SchemaColor {
    border: string;
    bg: string;
    text: string;
    badge: string;
}
declare function getSchemaColor(schema: string, orderedSchemas: string[], theme?: 'light' | 'dark'): SchemaColor;

interface GroupData {
    schema: string;
    color: SchemaColor;
    tableCount: number;
}
interface Props$3 {
    data: GroupData;
    style?: React.CSSProperties;
}
declare const SchemaGroupNode: react.MemoExoticComponent<({ data, style }: Props$3) => react.JSX.Element>;

interface TableData {
    schema: string;
    name: string;
    type: string;
    color: SchemaColor;
    theme: 'light' | 'dark';
}
interface Props$2 {
    data: TableData;
    selected?: boolean;
}
declare const TableNode: react.MemoExoticComponent<({ data, selected }: Props$2) => react.JSX.Element>;

interface Props$1 {
    supabase: RpcClient;
    schemaPrefix: string;
    schema: string | null;
    table: string | null;
    color: SchemaColor | null;
    onClose: () => void;
    theme?: 'light' | 'dark';
}
declare function ColumnPanel({ supabase, schemaPrefix, schema, table, color, onClose, theme }: Props$1): react.JSX.Element | null;

interface Props {
    schemas: string[];
    hidden: Set<string>;
    tableCountBySchema: Record<string, number>;
    onToggle: (schema: string) => void;
    theme?: 'light' | 'dark';
}
declare function SchemaControls({ schemas, hidden, tableCountBySchema, onToggle, theme }: Props): react.JSX.Element;

declare function ThemeProvider({ children }: {
    children: ReactNode;
}): react.JSX.Element;

type Theme$1 = 'dark' | 'light';
interface ThemeContextValue {
    theme: Theme$1;
    toggle: () => void;
    isManaged: boolean;
}
declare const ThemeContext: react.Context<ThemeContextValue>;
declare const useTheme$1: () => ThemeContextValue;

declare function computeLayout(tables: SchemaTable[], foreignKeys: ForeignKey[], hiddenSchemas: Set<string>, orderedSchemas: string[], theme?: 'light' | 'dark'): {
    nodes: Node[];
    edges: Edge[];
};

interface CalendarEvent {
    id: string;
    date: string;
    endDate?: string;
    title: string;
    color: string;
    meta?: Record<string, unknown>;
}

interface CalendarProps {
    events: CalendarEvent[];
    defaultView?: 'year' | 'month' | 'week';
    defaultDate?: string;
    onDayClick?: (date: string, events: CalendarEvent[]) => void;
    renderEvent?: (event: CalendarEvent) => ReactNode;
    /** Overrides the host `.dark` class. Only needed when a host themes a subtree. */
    theme?: 'light' | 'dark';
}
declare function Calendar({ events, defaultView, defaultDate, onDayClick, renderEvent, theme }: CalendarProps): react.JSX.Element;

type Theme = 'light' | 'dark';
/** The saved explicit override, or null if none/invalid. */
declare function getSavedTheme(): Theme | null;
/** Saved override wins; else the OS preference; else 'dark'. */
declare function resolveInitialTheme(): Theme;
/** Set document.documentElement.dataset.theme (no persistence). */
declare function applyTheme(t: Theme): void;
/** [current, toggle] — toggle flips, applies, and persists the new value. */
declare function useTheme(): [Theme, () => void];

type ThemeToggleControl = {
    theme: Theme;
    onToggle: () => void;
} | {
    theme?: undefined;
    onToggle?: undefined;
};
/**
 * `theme` and `onToggle` must be passed together (controlled) or both omitted
 * (uncontrolled, drives the component's own useDocumentTheme()). Passing one
 * without the other is not a valid state and is rejected at compile time.
 */
type ThemeToggleProps = ThemeToggleControl & {
    /** Button class. Defaults to 'ds-appbar-btn' (the AppBar window-control look). */
    className?: string;
};
/** The sun/moon mark. Extracted so the overflow menu's theme row is the same mark. */
declare function ThemeIcon({ theme }: {
    theme: Theme;
}): react.JSX.Element;
/**
 * The shared light/dark switcher. Uncontrolled by default (drives the document's
 * own data-theme via useDocumentTheme()); pass `theme` + `onToggle` to control it —
 * sbrain-desktop does, because its pixels live in a <webview> guest rather than its
 * own DOM.
 */
declare function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps): react.JSX.Element;

type ThemeType = 'light' | 'dark';
/**
 * A theme, as authored. `colors` is a partial override over BASE[type] — see
 * tokens.ts for why themes are partial rather than complete.
 *
 * The same shape whether the theme is a built-in compiled into this package or
 * a row out of sbrain_config.themes, so the registry can concatenate the two
 * without a second representation.
 */
interface ThemeDef {
    /** Stable slug. Referenced by the persisted selection, so it must not churn. */
    id: string;
    label: string;
    type: ThemeType;
    colors: PartialTokenMap;
    /** Picker order; ties break by label. Built-ins default to 100. */
    sortOrder?: number;
    /** Built-ins are the offline floor and cannot be deleted from the picker. */
    builtin?: boolean;
}
/** One row of sbrain_config.themes, as PostgREST returns it. */
interface RemoteThemeRow {
    id: string;
    label: string;
    type: string;
    colors: unknown;
    sort_order: number;
    updated_at: string;
    deleted_at: string | null;
}
/**
 * Validate and repair rather than trust — the same posture presets.ts takes
 * toward config.json. A theme row is remote data that a person hand-edits in
 * the Supabase table editor, so a typo in one color must not blank the app.
 *
 * Returns null only when the row is unusable as an identity (no id, or a type
 * that is neither light nor dark). A bad individual color is dropped and the
 * rest of the theme survives, because falling through to the base for one token
 * is a far better failure than discarding the theme.
 */
declare function parseThemeRow(row: RemoteThemeRow): ThemeDef | null;

/** Order here is the fallback picker order; sortOrder is what actually sorts. */
declare const BUILTIN_THEMES: readonly ThemeDef[];
/** What a fresh install opens on, and the fallback for an unknown saved id. */
declare const DEFAULT_THEME_ID = "github-dark";

/**
 * BASE[type] with the theme's overrides applied. Pure — no DOM.
 *
 * Explicit undefined values are dropped rather than spread: `colors` is a
 * Partial, and `{...base, ...{'--ds-bg': undefined}}` would punch a hole in an
 * otherwise complete palette instead of leaving the base value standing.
 */
declare function resolveTheme(theme: ThemeDef): TokenMap;
/**
 * Write a resolved theme onto the document.
 *
 * This is the ONLY place the app's theme state is expressed, and it deliberately
 * sets four things at once, because before the registry they were set in
 * different places and could disagree:
 *
 *   data-theme      the attribute appbar.css and every app stylesheet keys off.
 *                   Carries the TYPE, not the id — `[data-theme='light']` blocks
 *                   in masaudit/localhub keep working untouched under any theme.
 *   data-theme-id   the identity, for CSS that wants to target one theme.
 *   .dark class     what lib/theme.tsx, useDarkClass and console.css read. It
 *                   was never set by the shell path, so a `data-theme` app that
 *                   rendered ConsolePane or an sbrain comp would have shown a
 *                   dark console inside a light shell. Setting both here is what
 *                   makes the two ecosystems one theme.
 *   color-scheme    native form controls, caret, and default scrollbars. This
 *                   was hardcoded to `dark` in electron-ui's injected base
 *                   styles, so light mode kept dark native widgets.
 *
 * Tokens are written to the inline style of <html>, which outranks every :root
 * rule in every stylesheet without needing !important — that is why the CSS
 * blocks can stay as the pre-hydration fallback rather than being deleted.
 */
declare function applyResolvedTheme(theme: ThemeDef, tokens?: TokenMap): void;
/**
 * The inline <style>/<script> payload for first paint.
 *
 * Electron shows the window only once the page is ready, but React still mounts
 * after the first paint — so without this the window opens on the CSS default
 * (dark) and flips to the user's theme a frame later. Main injects the resolved
 * tokens as a plain :root rule before the bundle runs, so the first painted
 * frame is already correct.
 *
 * Emitted as CSS text rather than as inline style so it can go through
 * `insertCSS`, which is what electron-ui already uses for base styles.
 */
declare function themeToCss(theme: ThemeDef, tokens?: TokenMap): string;

/**
 * Fold sbrain_config.themes rows into the built-in set.
 *
 * Pure, so the whole policy is testable without a network — same posture as
 * bezel's mergeRemotePresets, which this deliberately mirrors.
 *
 * Rules, in order of how surprising they are:
 *  - A remote row REPLACES a built-in of the same id. That is the retune path:
 *    fixing Monokai's muted gray should not require a package release.
 *  - A tombstone (deleted_at) hides a remote theme but can never delete a
 *    built-in. Built-ins are the offline floor; a tombstone that could empty the
 *    picker would leave a machine with no themes the moment it went offline.
 *  - An unparseable row is skipped, not fatal. One bad hand-edit in the table
 *    editor must not take the picker down.
 */
declare function mergeRemoteThemes(rows: readonly RemoteThemeRow[], 
/**
 * Themes the APP ships, folded in beside the package built-ins.
 *
 * An app whose chrome has its own palette — sbrain-desktop aliases `--ds-*` onto the
 * federation tokens in @sbrain-inc/config — cannot express that as CSS any more, because
 * applyResolvedTheme writes the resolved palette to the inline style of <html> and inline
 * outranks every author rule. Supplying it as a THEME is how that palette survives.
 *
 * Treated as built-in: it is compiled into the app, so it is part of the same offline floor
 * and a tombstone must not be able to delete it. A remote row of the same id still retunes
 * it, which keeps the fix-a-color-without-a-release path open.
 */
appThemes?: readonly ThemeDef[]): ThemeDef[];
/**
 * The named theme, or the default, or — if even that is gone — the first one.
 *
 * `defaultId` lets an app choose what "no selection yet" means for IT. Without it every app
 * opens on github-dark, which is right for a package default and wrong for an app that ships
 * its own chrome palette: sbrain-desktop's content is painted from @sbrain-inc/config, and a
 * fresh install opening on GitHub's blues put the app bar on a different palette from
 * everything beneath it.
 *
 * It only decides the FALLBACK. A user who has picked a theme still gets their pick.
 */
declare function pickTheme(themes: readonly ThemeDef[], id: string | null | undefined, defaultId?: string): ThemeDef;
/**
 * What the sun/moon toggle should switch to.
 *
 * VSCode keeps a preferred theme per type (`workbench.preferredLightColorTheme`
 * / `preferredDarkColorTheme`) rather than pairing themes up, so toggling out of
 * Monokai and back returns you to Monokai rather than to whatever dark theme
 * happens to sort first. `preferred` is that memory, keyed by type.
 *
 * Falls back to the first theme of the target type, then to the current theme —
 * a library with no light theme at all makes the toggle a no-op rather than an
 * error.
 */
declare function counterpartTheme(themes: readonly ThemeDef[], current: ThemeDef, preferred?: Partial<Record<ThemeType, string>>): ThemeDef;

/** The selection, as persisted locally and remotely. */
interface ThemeSelection {
    id: string;
    /** Last-used theme per type, so the sun/moon toggle returns you where you were. */
    preferred: Partial<Record<ThemeType, string>>;
}
interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/**
 * The locally persisted selection.
 *
 * Migrates the pre-registry `ds-theme` value rather than ignoring it: everyone
 * running these apps today has a light/dark choice saved under that key, and
 * silently resetting them all to dark on upgrade is the kind of small betrayal
 * that makes a theme system feel broken on day one. The legacy key is read, not
 * deleted — rolling back to a previous build should still find it.
 */
declare function loadSelection(storage: StorageLike, defaultId?: string): ThemeSelection;
declare function saveSelection(storage: StorageLike, selection: ThemeSelection): void;
/**
 * Update `preferred` for the type being selected. Called on every selection so
 * the toggle's memory tracks what you actually last used of each type.
 */
declare function rememberPreferred(selection: ThemeSelection, theme: ThemeDef): ThemeSelection;
/** Cache the remote rows so the next cold start has the full library offline. */
declare function cacheRows(storage: StorageLike, rows: readonly RemoteThemeRow[]): void;
declare function readCachedRows(storage: StorageLike): RemoteThemeRow[];
/**
 * The legacy key's light/dark, written before React mounts.
 *
 * Exported for the tiny pre-hydration script each app inlines in index.html:
 * the CSS fallback blocks key off [data-theme], so setting the attribute from
 * storage before first paint is what stops a light-theme user seeing a dark
 * flash. The full token set arrives from main's injected CSS; this is the
 * no-Electron (browser/dev-server) path.
 */
declare const PREPAINT_SNIPPET = "(function(){try{var i=localStorage.getItem('ds-theme-id')||'';var t=localStorage.getItem('ds-theme');var d=t?t:(i.indexOf('light')>=0?'light':'dark');document.documentElement.dataset.theme=d;if(i)document.documentElement.dataset.themeId=i;document.documentElement.classList.toggle('dark',d==='dark');document.documentElement.style.colorScheme=d;}catch(e){}})()";

/**
 * The main-process side, exposed at `window.<app>.theme` by the preload bridge.
 *
 * Every method is optional and every one is allowed to fail: the Supabase
 * service-role key lives in main and is never handed to the renderer, so this
 * is the renderer's only route to the theme tables — and an app that has not
 * wired it up, or a machine with no credentials, must still get a working
 * picker off the built-ins.
 */
interface ThemeBridge {
    list?(): Promise<RemoteThemeRow[]>;
    getSelection?(): Promise<ThemeSelection | null>;
    setSelection?(selection: ThemeSelection): Promise<void>;
    /**
     * Hand main the resolved CSS for the active theme, to be replayed into the
     * NEXT launch before the bundle runs. Main stores it opaquely — resolving a
     * theme means owning the token contract and the base palettes, which live in
     * this package, so computing it there would be a second copy to drift.
     */
    cachePaint?(css: string): Promise<unknown>;
}
interface ThemeRegistry {
    /** Built-ins merged with whatever the remote library added, in picker order. */
    themes: ThemeDef[];
    theme: ThemeDef;
    select(id: string): void;
    /** Flip light↔dark, returning to the last theme used of the target type. */
    toggle(): void;
    /** False until the remote list has been folded in (or has failed). */
    loading: boolean;
}
/**
 * The whole theme system, as one hook.
 *
 * Local-first: the cached row set and the saved selection are applied
 * synchronously during the first render, so the app paints the right theme
 * before any promise settles. The network is then allowed to correct it.
 *
 * The remote SELECTION is adopted on startup — that is what makes the choice
 * follow you between machines — but only once, and only before you touch the
 * picker. Re-adopting it later would mean a background refresh could yank the
 * theme out from under someone who just changed it.
 */
/**
 * Per-app overrides. Both exist for the same reason: an app can have chrome colours of its
 * own, and since the registry writes tokens inline it can no longer express them in CSS.
 */
interface ThemeRegistryOptions {
    /** Themes the app ships. Folded in beside the built-ins, and treated as built-in. */
    themes?: readonly ThemeDef[];
    /** What this app opens on before the user has picked anything. */
    defaultThemeId?: string;
}
declare function useThemeRegistry(bridge?: ThemeBridge, storage?: Storage, opts?: ThemeRegistryOptions): ThemeRegistry;

/**
 * An app-supplied row in the ⋯ menu.
 *
 * The menu exists for chrome-level options that are set rarely and do not deserve a
 * permanent slot beside the constantly-used window controls — an app's own Settings
 * entry is exactly that, and before this there was no way to add one.
 */
interface OverflowItem {
    label: string;
    /** Optional; the row keeps the icon column either way so labels stay aligned. */
    icon?: ReactNode;
    onSelect: () => void;
}
type OverflowMenuProps = ThemeToggleControl & {
    /** Pass `window.<app>`. The Full screen row is omitted when it has no `fullscreen`. */
    bridge?: ShellBridge;
    /**
     * From `useThemeRegistry()`. When present the menu shows the full theme list;
     * when absent it falls back to the original single light/dark toggle row, so an
     * app that has not adopted the registry keeps working unchanged.
     */
    themes?: ThemeRegistry;
    /**
     * App rows, rendered ABOVE Theme and Full screen — the app's own concerns come
     * before the shell's. Optional and additive: every existing caller renders
     * exactly the menu it rendered before.
     */
    items?: OverflowItem[];
};
/**
 * The app bar's ⋯ menu: chrome-level options that are set rarely and do not deserve a
 * permanent slot next to the constantly-used window controls.
 *
 * `theme` + `onToggle` are the same controlled/uncontrolled pair `ThemeToggle` takes —
 * sbrain-desktop controls it, because its pixels live in a <webview> guest rather than
 * its own DOM; every other app leaves both off and drives the document directly.
 *
 * The panel is `position: absolute` INSIDE `.ds-appbar`, not portalled to the body: the
 * bar lives in a counter-scaled zoom subtree (`useAppBarZoomVar` publishes the live page
 * factor and `.ds-appbar` divides by it), and a portalled panel would escape that subtree
 * and drift away from its own button at any zoom other than 100%.
 */
declare function OverflowMenu({ theme, onToggle, bridge, themes, items }: OverflowMenuProps): react.JSX.Element;

/** The renderer-side zoom API exposed by exposeShellBridge (wired by registerZoom). */
interface ZoomBridge {
    in(): void;
    out(): void;
    reset(): void;
    get(): Promise<number>;
    /**
     * This app's neutral ("home") factor — where content opens and where Reset returns.
     * Not always 1: bezel opens its terminals at 1.1. Optional because it arrived in
     * `@devkit-inc/electron-ui` 2.5.0; on an older shell the AppBar falls back to
     * `ZOOM_NEUTRAL`, which is what those shells actually use.
     */
    neutral?(): Promise<number>;
    /** Subscribe to factor changes; returns an unsubscribe fn. */
    onChange(cb: (factor: number) => void): () => void;
}
/** True fullscreen (covers the taskbar), exposed by exposeShellBridge in electron-ui 2.4.0+. */
interface FullscreenBridge {
    toggle(): void;
    isFullscreen(): Promise<boolean>;
    /** Subscribe to enter/leave transitions; returns an unsubscribe fn. */
    onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
}
/** The base bridge every tool's `window.<app>` satisfies (tools extend it with their own IPC). */
interface ShellBridge {
    isElectron: boolean;
    isDev: boolean;
    minimize(): void;
    maximize(): void;
    close(): void;
    /** Page-zoom API; present in Electron builds that call registerZoom. */
    zoom?: ZoomBridge;
    /**
     * Live maximized state. Both are optional because they arrived in
     * `@devkit-inc/electron-ui` 2.3.0 — an app on an older shell simply keeps the
     * previous static Maximize button instead of breaking.
     */
    isMaximized?(): Promise<boolean>;
    /** Subscribe to maximize/restore transitions; returns an unsubscribe fn. */
    onMaximizeChange?(cb: (maximized: boolean) => void): () => void;
    /**
     * True-fullscreen API; present in Electron builds on `@devkit-inc/electron-ui` 2.4.0+.
     * Optional for the same reason `isMaximized` is: an app on an older shell hides the
     * Full screen row rather than breaking.
     */
    fullscreen?: FullscreenBridge;
    /**
     * Theme library + selection, served from masautt-db by electron-ui's
     * registerTheme. Optional on this type so an app on an older electron-ui
     * simply falls back to the built-in themes instead of throwing.
     */
    theme?: ThemeBridge;
}
interface AppBarProps {
    /** Pass `window.<app>`. Explicit (not a magic global) so it is unit-testable. */
    bridge: ShellBridge | undefined;
    /** Base brand, e.g. "localhub". Rendered as "localhub (dev)" when `bridge.isDev`. */
    brand: string;
    /** Built-in Back/Forward via `window.history`. Default true. */
    nav?: boolean;
    /** Tool-specific buttons (Refresh, ⌖ folder), rendered before the drag spacer. */
    actions?: ReactNode;
    /** Show the ⋯ overflow menu (theme + full screen) in the window-control cluster. Default true. */
    menu?: boolean;
    /**
     * Opt out of driving the document's theme. sbrain-desktop sets this: its pixels
     * live in a <webview> guest, so the host document is not what needs theming and
     * applying tokens here would style only the chrome around the content.
     */
    manageTheme?: boolean;
    /**
     * App rows for the ⋯ menu, e.g. a Settings entry. Passed straight through to
     * OverflowMenu; ignored when `menu` is false.
     */
    menuItems?: OverflowItem[];
}
/**
 * Frameless window title bar for the Electron desktop shell. The whole strip is a
 * drag region; every button opts out. Window controls are full-height and flush to
 * the top-right corner so the ✕ is clickable in the corner (Fitts's law).
 * Renders nothing outside Electron.
 */
declare function AppBar({ bridge, brand, nav, actions, menu, manageTheme, menuItems, }: AppBarProps): react.JSX.Element | null;

interface VisualZoomViewportProps {
    children: ReactNode;
    /** Maximum magnification (default 3). */
    max?: number;
    /** Optional extra class on the viewport wrapper. */
    className?: string;
}
/**
 * App-agnostic browser-style pinch-to-magnify layer. Wrap an app's content
 * region in it; the AppBar/titlebar stays OUTSIDE (so it is excluded by
 * construction). A pinch — touchscreen two-finger or touchpad Ctrl+wheel —
 * magnifies the rendered pixels via a CSS transform (no reflow) around the focal
 * point; sticky after you lift; one-finger drag pans when zoomed; pinch back to
 * 1x resets. Transient (nothing persisted). Separate from the main-process page
 * zoom (registerZoom / Ctrl+/-).
 *
 * Transform-only: it NEVER owns the host's scrolling. At 1x it is transparent —
 * one-finger drag and plain wheel fall through to the app's native scroll; only a
 * 2-finger pinch / Ctrl+wheel is caught (to begin zooming), and pan gestures once
 * zoomed. It ships as a layout-transparent flex pass-through so dropping it
 * between the titlebar and content does not disturb the app's height/flex chain.
 */
declare function VisualZoomViewport({ children, max, className }: VisualZoomViewportProps): react.JSX.Element;

/**
 * Title-bar zoom indicator. Renders nothing without a zoom bridge, and hides itself at
 * the app's neutral zoom (its home position — 100% for most tools, 110% for bezel; see
 * useZoomNeutral). Shows a magnifier (plus above neutral, minus below); clicking opens a
 * popover with the current percentage and minus / plus / reset controls. Dismisses on
 * outside-click or Esc.
 */
declare function ZoomIndicator({ bridge }: {
    bridge: ShellBridge;
}): react.JSX.Element | null;

/**
 * The FLEET-DEFAULT neutral ("100%-equivalent") page-zoom factor, and the fallback for a
 * bridge that can't report its own. Mirrors `DEFAULT_NEUTRAL` in `@devkit-inc/electron-ui`'s
 * `src/zoom.ts` (a separate main-process bundle, so the constant can't be imported).
 *
 * An individual app may sit somewhere else — bezel passes `neutral: 1.1` to `registerZoom`
 * — so anything deciding "is the page at home?" must use `useZoomNeutral`, which asks the
 * main process, rather than this constant.
 */
declare const ZOOM_NEUTRAL = 1;
/**
 * This app's neutral ("home") zoom factor, read from the bridge. Returns `null` until it
 * resolves, so callers can render the not-yet-known state as "at home" instead of
 * flashing an indicator against a wrong assumption. Falls back to `ZOOM_NEUTRAL` for a
 * bridge with no `neutral()` (electron-ui < 2.5.0), which is the value those shells use.
 */
declare function useZoomNeutral(zoom: ZoomBridge | undefined): number | null;
declare function useZoomFactor(zoom: ZoomBridge | undefined): number;

/**
 * Track whether the window is maximized, so the AppBar can offer Restore instead
 * of claiming "Maximize" on an already-maximized window.
 *
 * Seeds from `bridge.isMaximized()` and stays in sync via `bridge.onMaximizeChange`.
 * Both are optional on the bridge: an app running an older `@devkit-inc/electron-ui`
 * has neither, and gets `false` forever — the same static button it had before,
 * rather than a crash. The seed Promise is cancelled on unmount / bridge change so
 * it cannot set state late, and so React strict-mode's double-invoke is harmless.
 */
declare function useMaximized(bridge: ShellBridge | undefined): boolean;

/**
 * Light-dismiss for an app-bar popover: closes on an outside mousedown, on Escape, and when
 * the window loses focus. Inert while `open` is false — no listeners are attached at all.
 *
 * `ref` is the whole trigger+panel wrapper, not the panel: a mousedown on the trigger itself
 * must be treated as INSIDE, or this listener closes the panel a tick before the trigger's own
 * onClick can toggle it and the button stops working. For the same reason it is `mousedown`
 * and not `click` — a click listener fires after the NEXT trigger's onClick and would re-close
 * what that click just opened, which is the double-click regression BreadcrumbNav documents.
 *
 * The window-blur rule is what makes this correct in a shell that hosts a <webview>. There the
 * guest is a separate WebContents and the bar is the only part of the page in THIS document:
 * a click on the content below never dispatches a mousedown here, so an outside-click listener
 * alone leaves the panel hanging open over the thing the user was trying to click. Measured on
 * a real sbrain-desktop shell, the host still receives a window `blur` when focus moves into
 * the guest — with or without anything focused in the host beforehand — so blur is the signal
 * that survives the process boundary. It also gives the ordinary behaviour every native menu
 * has: alt-tab away and the menu is not still open when you come back.
 */
declare function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void): void;

/**
 * Track whether the window is in true fullscreen, so the overflow menu can check the
 * Full screen row and the AppBar can hide itself.
 *
 * Deliberately parallel to `useMaximized`: seeds from `bridge.fullscreen.isFullscreen()`,
 * stays in sync via `onFullscreenChange`, and returns `false` forever when the bridge has
 * no `fullscreen` at all (an app on an older `@devkit-inc/electron-ui`). The seed Promise
 * is canceled on unmount / bridge change so it cannot set state late, which also makes
 * React strict-mode's double-invoke harmless.
 */
declare function useFullscreen(bridge: ShellBridge | undefined): boolean;

/** One selectable sibling inside a crumb's dropdown. */
interface CrumbOption {
    id: string;
    label: string;
    /** Raw SVG inner markup (matches CompEntry.icon). A missing icon renders an empty svg, never throws. */
    icon?: string | null;
    /**
     * Draw a divider above this option, grouping it and everything after it below the line.
     * One divider per panel regardless of how many options are flagged — the line separates
     * a level's admin from that level's comps, and a second line would imply a third group.
     */
    separated?: boolean;
}
/** A non-navigational item appended below a divider in a crumb's dropdown (e.g. sign out). */
interface CrumbAction {
    id: string;
    label: string;
    icon?: string | null;
    onSelect: () => void;
}
interface Crumb {
    id: string;
    label: string;
    icon?: string | null;
    /** Renders the uppercase letter-spaced wordmark treatment — the root crumb. */
    brand?: boolean;
    options?: CrumbOption[];
    actions?: CrumbAction[];
    onSelect?: (id: string) => void;
}
/**
 * Deliberately opaque: the host supplies availability and handlers, not a history object.
 * sbrain-desktop drives this from a <webview>'s session history, but a host with an
 * internal stack satisfies the same contract without the component changing.
 */
interface HistoryControls {
    canBack: boolean;
    canForward: boolean;
    onBack: () => void;
    onForward: () => void;
    /**
     * Re-fetch the current view. Optional and unpaired with a `can*` flag: unlike a direction,
     * the current view is always reloadable, so the button is never disabled. Omit it and no
     * reload button renders — a host whose "current view" is local state has nothing to fetch.
     */
    onReload?: () => void;
}
interface BreadcrumbNavProps {
    crumbs: Crumb[];
    /**
     * Omit in a browser host. There the browser's own back button exists and a second one
     * would be a duplicate; the arrows are only correct in frameless chrome that removed it.
     */
    history?: HistoryControls;
}
/**
 * A navigation path: optional history controls, then `a | b | c` where any crumb may open a
 * dropdown of its siblings. Purely presentational — no router, no Electron, no data access.
 *
 * Each panel is `position: absolute; left: 0` inside its OWN segment, so its rows align under
 * that segment's label structurally. An earlier version of this bar was one indivisible
 * trigger and had to pad every row with an invisible `sbrain /` prefix to fake that
 * alignment; per-segment anchoring is what removed the hack.
 */
declare function BreadcrumbNav({ crumbs, history }: BreadcrumbNavProps): react.JSX.Element;

/**
 * The theme list, as a flyout off the ⋯ menu's "Theme" row.
 *
 * A flyout rather than an inline section because the library is unbounded — it
 * is whatever sbrain_config.themes holds — and a menu that grows a row per theme
 * would eventually be taller than the window. Grouped by type, matching how
 * VSCode's picker separates its light and dark lists, so the toggle's behaviour
 * (jump to the other group) is legible in the layout itself.
 *
 * Opens to the LEFT: the ⋯ button is the rightmost thing in the bar, so a
 * right-opening panel would hang off the screen edge.
 */
declare function ThemePicker({ registry, onPicked, }: {
    registry: ThemeRegistry;
    onPicked?: () => void;
}): react.JSX.Element;

declare function MaximizeGlyph(): react.JSX.Element;
declare function RestoreGlyph(): react.JSX.Element;
declare function FullscreenGlyph(): react.JSX.Element;
declare function CheckGlyph(): react.JSX.Element;

interface ConsolePaneProps {
    lines: string[];
    maxLines?: number;
    ariaLabel?: string;
    className?: string;
}
declare function ConsolePane({ lines, maxLines, ariaLabel, className, }: ConsolePaneProps): react.JSX.Element;

interface AnsiSpan {
    text: string;
    classes: string[];
}
declare function parseAnsi(line: string): AnsiSpan[];

export { type AnsiSpan, AppBar, type AppBarProps, BUILTIN_THEMES, BreadcrumbNav, type BreadcrumbNavProps, Calendar, type CalendarEvent, type CalendarProps, CheckGlyph, ColumnPanel, ConsolePane, type ConsolePaneProps, type Crumb, type CrumbAction, type CrumbOption, DEFAULT_THEME_ID, type ForeignKey, type FullscreenBridge, FullscreenGlyph, type HistoryControls, MaximizeGlyph, type OverflowItem, OverflowMenu, type OverflowMenuProps, PREPAINT_SNIPPET, type RemoteThemeRow, RestoreGlyph, type RpcClient, type SchemaColor, type SchemaColumn, SchemaControls, SchemaExplorer, SchemaExplorerPanel, SchemaGroupNode, type SchemaTable, type ShellBridge, type StorageLike, TableNode, type Theme, type ThemeBridge, ThemeContext, type ThemeDef, ThemeIcon, ThemePicker, ThemeProvider, type ThemeRegistry, type ThemeRegistryOptions, type ThemeSelection, ThemeToggle, type ThemeToggleControl, type ThemeToggleProps, type ThemeType, VisualZoomViewport, type VisualZoomViewportProps, ZOOM_NEUTRAL, type ZoomBridge, ZoomIndicator, applyResolvedTheme, applyTheme, cacheRows, computeLayout, counterpartTheme, createUseIcon, getSavedTheme, getSchemaColor, loadSelection, mergeRemoteThemes, parseAnsi, parseThemeRow, pickTheme, readCachedRows, rememberPreferred, resolveInitialTheme, resolveTheme, saveSelection, themeToCss, useColumns, useDarkClass, useDismiss, useTheme as useDocumentTheme, useFullscreen, useMaximized, useSchemaData, useTheme$1 as useTheme, useThemeRegistry, useZoomFactor, useZoomNeutral };
