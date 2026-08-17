"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FONTS = exports.DEFAULT_BASE_STYLES = void 0;
exports.createShellWindow = createShellWindow;
const electron_1 = require("electron");
/** Dark window chrome injected into every page load: native dark scrollbars/controls
 *  (color-scheme) plus a theme-agnostic translucent scrollbar that reads on any dark
 *  background (localhub/masaudit dark, storybook neon-on-near-black). Deliberately the
 *  same 6px fully-rounded shape as `.scroll-slim` in @devkit-inc/react-ui/scroll.css —
 *  these unclassed rules cover the document bar and any pane not yet migrated, so the
 *  two must agree. Change them together. */
exports.DEFAULT_BASE_STYLES = `
:root { color-scheme: dark; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 9999px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.30); }
`.trim();
/** Chromium default font families for unstyled text and the CSS generic keywords
 *  (standard / sans-serif / serif / monospace). Windows-tuned to match what Chrome
 *  renders, so Electron stops falling back to its built-in serif default for any
 *  text an app doesn't explicitly style. On other platforms the unknown names fall
 *  back harmlessly to Chromium's own per-OS defaults. */
exports.DEFAULT_FONTS = {
    standard: 'Segoe UI',
    sansSerif: 'Segoe UI',
    serif: 'Georgia',
    monospace: 'Consolas',
};
/**
 * Create a frameless, polished BrowserWindow: hidden until ready-to-show,
 * context-isolated, with reload (F5 / Ctrl+R) and back/forward (Alt+Left/Right)
 * keybindings, and dark window chrome injected on every load. The caller owns
 * setAppIdentity(<app id>) and loading the URL; this factory suppresses the app
 * menu (keepAppMenu opts out).
 */
function createShellWindow(opts) {
    if (!opts.keepAppMenu)
        electron_1.Menu.setApplicationMenu(null);
    const defaultFontFamily = opts.defaultFontFamily === false ? undefined : { ...exports.DEFAULT_FONTS, ...opts.defaultFontFamily };
    const win = new electron_1.BrowserWindow({
        width: opts.width ?? 1280,
        height: opts.height ?? 860,
        minWidth: opts.minWidth ?? 900,
        minHeight: opts.minHeight ?? 600,
        show: false,
        frame: false,
        backgroundColor: opts.backgroundColor,
        icon: opts.icon,
        webPreferences: {
            preload: opts.preload,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: opts.webviewTag ?? false,
            // The preload uses exposeShellBridge from this package; a sandboxed preload
            // (Electron's default) can only require 'electron', so it would fail to load
            // and the app's window.<name> bridge (incl. isElectron → title bar) silently
            // never appears. Disable the sandbox; contextIsolation still isolates the page.
            sandbox: false,
            // Make Electron's fallback fonts match Chrome so unstyled text doesn't render
            // in the built-in serif default on Windows.
            defaultFontFamily,
        },
    });
    win.once('ready-to-show', () => win.show());
    // Inject dark chrome on every load so it survives navigation (server URL,
    // error/prompt pages) and SPA full reloads. baseStyles === false opts out.
    const css = opts.baseStyles === false ? null : (opts.baseStyles ?? exports.DEFAULT_BASE_STYLES);
    if (css) {
        win.webContents.on('did-finish-load', () => {
            void win.webContents.insertCSS(css);
        });
    }
    win.webContents.on('before-input-event', (_e, input) => {
        if (input.type !== 'keyDown')
            return;
        const k = input.key.toLowerCase();
        // Handled here rather than in the page so they keep working while the app bar is
        // hidden, and inside a <webview> guest whose keydowns never reach the host document.
        if (k === 'f11')
            win.setFullScreen(!win.isFullScreen());
        // Exit-only, and only while fullscreen: apps use Escape for their own dialogs and
        // popovers, so claiming it unconditionally would break every one of them.
        else if (k === 'escape' && win.isFullScreen())
            win.setFullScreen(false);
        else if (k === 'f5' || (input.control && k === 'r'))
            win.webContents.reload();
        else if (input.alt && k === 'arrowleft' && win.webContents.navigationHistory.canGoBack())
            win.webContents.navigationHistory.goBack();
        else if (input.alt && k === 'arrowright' && win.webContents.navigationHistory.canGoForward())
            win.webContents.navigationHistory.goForward();
    });
    return win;
}
