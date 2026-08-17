import { BrowserWindow } from 'electron';
/** Dark window chrome injected into every page load: native dark scrollbars/controls
 *  (color-scheme) plus a theme-agnostic translucent scrollbar that reads on any dark
 *  background (localhub/masaudit dark, storybook neon-on-near-black). Deliberately the
 *  same 6px fully-rounded shape as `.scroll-slim` in @devkit-inc/react-ui/scroll.css —
 *  these unclassed rules cover the document bar and any pane not yet migrated, so the
 *  two must agree. Change them together. */
export declare const DEFAULT_BASE_STYLES: string;
/** Chromium default font families for unstyled text and the CSS generic keywords
 *  (standard / sans-serif / serif / monospace). Windows-tuned to match what Chrome
 *  renders, so Electron stops falling back to its built-in serif default for any
 *  text an app doesn't explicitly style. On other platforms the unknown names fall
 *  back harmlessly to Chromium's own per-OS defaults. */
export declare const DEFAULT_FONTS: {
    readonly standard: "Segoe UI";
    readonly sansSerif: "Segoe UI";
    readonly serif: "Georgia";
    readonly monospace: "Consolas";
};
type FontFamilies = {
    standard?: string;
    serif?: string;
    sansSerif?: string;
    monospace?: string;
};
export interface ShellWindowOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    backgroundColor: string;
    icon?: string;
    preload: string;
    webviewTag?: boolean;
    baseStyles?: string | false;
    keepAppMenu?: boolean;
    defaultFontFamily?: FontFamilies | false;
}
/**
 * Create a frameless, polished BrowserWindow: hidden until ready-to-show,
 * context-isolated, with reload (F5 / Ctrl+R) and back/forward (Alt+Left/Right)
 * keybindings, and dark window chrome injected on every load. The caller owns
 * setAppIdentity(<app id>) and loading the URL; this factory suppresses the app
 * menu (keepAppMenu opts out).
 */
export declare function createShellWindow(opts: ShellWindowOptions): BrowserWindow;
export {};
