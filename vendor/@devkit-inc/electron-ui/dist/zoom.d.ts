import type { App, BrowserWindow } from 'electron';
export interface ZoomOptions {
    app: App;
    /**
     * Which contents the factor is applied to.
     *
     * `'window'` (default) — this window's own contents, the single-renderer case
     * (localhub / masaudit / storybook). Their `AppBar` counter-scales itself off
     * `--ds-page-factor`, so only page content appears to zoom.
     *
     * `'webviews'` — the `<webview>` guests attached to this window; the window's own
     * contents are never zoomed. For a shell whose chrome and content are separate
     * web-contents (sbrain-desktop): the chrome stays put by construction, and zoom
     * lands where the content actually is. Chromium zoom is per-origin per-session, so
     * it does not cross the webview boundary on its own.
     *
     * The keyboard shortcut is listened for on the window AND on every guest in both
     * modes — a focused guest swallows key events the host would otherwise see, and
     * that is about input routing, not about who gets zoomed.
     */
    zoomTarget?: 'window' | 'webviews';
    /**
     * This app's neutral ("home") zoom factor: content opens here on first launch, and
     * Ctrl+0 / the popover's Reset return here. Defaults to `DEFAULT_NEUTRAL` (1 = 100%),
     * the fleet-wide home. Override it for an app whose content is designed larger —
     * bezel's terminals open at 1.1.
     *
     * The renderer does NOT need to be told this value separately: it reads it back over
     * `zoom:neutral` (exposed as `zoom.neutral()` by `exposeShellBridge`), which is what
     * `@devkit-inc/react-ui`'s AppBar uses to hide the zoom indicator at home and to
     * counter-scale itself.
     *
     * A value off the `ZOOM_STEPS` ladder is legal but leaves the home position on a rung
     * Ctrl+ and Ctrl- can never land on again — only Ctrl+0 returns to it.
     */
    neutral?: number;
}
/**
 * The fleet-wide default neutral ("home") zoom factor — 100%. Per-app overrides go
 * through `ZoomOptions.neutral`.
 */
export declare const DEFAULT_NEUTRAL = 1;
/**
 * Wire keyboard page zoom to this window: Ctrl+/- (and numpad), Ctrl+0 reset, plus the
 * renderer popover's zoom:in/out/reset/get IPC. The main process is the single source of
 * truth; the factor is restored from and persisted to a dedicated `zoom.json` in the
 * app's userData dir, re-applied on every navigation (per-page zoom resets on loadURL).
 * Call once per window, alongside registerWindowControls. Single-window apps only (uses
 * global ipcMain channels).
 *
 * Note: pinch gestures do NOT drive this page zoom — pinch is browser-style visual
 * magnify, handled in the renderer by VisualZoomViewport (@devkit-inc/react-ui).
 */
export declare function registerZoom(win: BrowserWindow, opts: ZoomOptions): void;
