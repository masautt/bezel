export interface WindowControlColors {
    fg?: string;
    hover?: string;
    close?: string;
}
/**
 * The frameless min/max/close cluster as injectable HTML, wired to
 * window.<bridge>.minimize()/maximize()/close(). For pre-SPA data: pages
 * (error/prompt) that can't render the React <AppBar>. Pass colors to theme it.
 */
export declare function windowControlsHtml(bridge: string, colors?: WindowControlColors): string;
export interface DataPageOptions {
    /** Renderer global for the window controls, e.g. 'localhub' → window.localhub. */
    bridge: string;
    /** The centered inner HTML (e.g. a `<div>` with a heading + message/button). */
    body: string;
    /** Page background. Default '#0d1117'. */
    background?: string;
    /** Body text color. Default '#e6edf3'. */
    color?: string;
    /** Window-control button theming, forwarded to windowControlsHtml. */
    controls?: WindowControlColors;
}
/**
 * A complete `data:text/html` page for pre-SPA states (error, folder-prompt) that
 * can't render the React app: a full-height drag region, the frameless window
 * controls, and the supplied centered body. Returns a ready-to-`loadURL` data URI.
 */
export declare function dataPageShell(opts: DataPageOptions): string;
