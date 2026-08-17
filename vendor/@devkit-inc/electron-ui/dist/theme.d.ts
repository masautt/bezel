import type { App, BrowserWindow } from 'electron';
/** `~/source/orgs`, derived rather than hardcoded so another machine still works. */
export declare const defaultOrgsRoot: () => string;
export interface ThemeRow {
    id: string;
    label: string;
    type: string;
    colors: unknown;
    sort_order: number;
    updated_at: string;
    deleted_at: string | null;
}
export interface ThemeSelection {
    id: string;
    preferred?: {
        light?: string;
        dark?: string;
    };
}
/** Live theme rows, or null when the library is unreachable. */
export declare function listThemes(orgsRoot?: string): Promise<ThemeRow[] | null>;
/**
 * Pick the row that applies: an app-specific row wins over the global `'*'` row.
 *
 * The global row is the normal case and the reason the table is keyed this way —
 * one choice follows the user across masaudit, localhub, bezel and sbrain. The
 * per-app override exists for the app you deliberately want to look different.
 *
 * Pure and exported so the precedence is testable without a network, the same
 * way bezel keeps mergeRemotePresets separate from its transport.
 */
export declare function resolveSelectionRows(rows: ReadonlyArray<{
    app: string;
    value: ThemeSelection;
}> | null, app: string): ThemeSelection | null;
/** The stored selection for `app`, or null when unreachable or unset. */
export declare function getSelection(app: string, orgsRoot?: string): Promise<ThemeSelection | null>;
/**
 * Persist the selection. `scope` defaults to '*' so choosing a theme in any app
 * moves all of them — that is the behaviour the picker is for. Pass the app name
 * to pin one app instead.
 */
export declare function setSelection(selection: ThemeSelection, scope?: string, orgsRoot?: string): Promise<boolean>;
/**
 * The cached first-paint CSS, as a base-styles fragment.
 *
 * Electron holds the window hidden until ready-to-show, but React still mounts
 * after first paint — so without this the window opens on the stylesheet default
 * (dark) and snaps to the user's theme a frame later. The renderer hands main the
 * resolved CSS whenever the theme changes (`theme:cachePaint`); main replays it
 * into the next launch before the bundle runs.
 *
 * The CSS is stored opaquely rather than recomputed here on purpose: resolving a
 * theme means owning the token contract and the base palettes, which live in
 * @devkit-inc/react-ui. Duplicating them in main is how the two would drift.
 */
export declare function themedBaseStyles(app: App, base: string): string;
export interface ThemeOptions {
    /** The electron App, for the userData config cache. */
    app: App;
    /** Preference scope. '*' (default) shares one choice across every shell. */
    scope?: string;
    orgsRoot?: string;
}
/**
 * Wire the `theme:*` channels the renderer's ThemeBridge calls. Call once beside
 * registerWindowControls(win).
 */
export declare function registerTheme(win: BrowserWindow, opts: ThemeOptions): void;
