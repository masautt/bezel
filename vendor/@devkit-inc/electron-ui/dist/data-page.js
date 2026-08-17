"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowControlsHtml = windowControlsHtml;
exports.dataPageShell = dataPageShell;
/**
 * The frameless min/max/close cluster as injectable HTML, wired to
 * window.<bridge>.minimize()/maximize()/close(). For pre-SPA data: pages
 * (error/prompt) that can't render the React <AppBar>. Pass colors to theme it.
 */
function windowControlsHtml(bridge, colors = {}) {
    const fg = colors.fg ?? '#8b949e';
    const hover = colors.hover ?? '#21262d';
    const close = colors.close ?? '#da3633';
    return (`<style>.ds-winctl{position:fixed;top:0;right:0;display:flex;z-index:10;-webkit-app-region:no-drag}` +
        `.ds-winctl button{-webkit-app-region:no-drag;background:transparent;border:none;color:${fg};` +
        `width:42px;height:30px;font-size:14px;line-height:1;cursor:pointer}` +
        `.ds-winctl button:hover{background:${hover};color:#fff}.ds-winctl .x:hover{background:${close};color:#fff}</style>` +
        `<div class="ds-winctl">` +
        `<button title="Minimize" onclick="window.${bridge}.minimize()">─</button>` +
        `<button title="Maximize" onclick="window.${bridge}.maximize()">▢</button>` +
        `<button class="x" title="Close" onclick="window.${bridge}.close()">✕</button>` +
        `</div>`);
}
/**
 * A complete `data:text/html` page for pre-SPA states (error, folder-prompt) that
 * can't render the React app: a full-height drag region, the frameless window
 * controls, and the supplied centered body. Returns a ready-to-`loadURL` data URI.
 */
function dataPageShell(opts) {
    const bg = opts.background ?? '#0d1117';
    const color = opts.color ?? '#e6edf3';
    const html = `<!doctype html><meta charset=utf-8><body style="font-family:'Segoe UI',sans-serif;` +
        `background:${bg};color:${color};display:grid;place-items:center;height:100vh;margin:0;-webkit-app-region:drag">` +
        windowControlsHtml(opts.bridge, opts.controls) +
        opts.body +
        `</body>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}
