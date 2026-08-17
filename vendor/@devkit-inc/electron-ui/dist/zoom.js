"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NEUTRAL = void 0;
exports.registerZoom = registerZoom;
const electron_1 = require("electron");
const zoom_ladder_1 = require("./zoom-ladder");
const config_1 = require("./config");
/**
 * The fleet-wide default neutral ("home") zoom factor — 100%. Per-app overrides go
 * through `ZoomOptions.neutral`.
 */
exports.DEFAULT_NEUTRAL = 1;
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
function registerZoom(win, opts) {
    const { app, zoomTarget = 'window', neutral: appNeutral = exports.DEFAULT_NEUTRAL } = opts;
    const neutral = (0, zoom_ladder_1.clamp)(appNeutral);
    let factor = (0, zoom_ladder_1.clamp)((0, config_1.readUserConfig)(app, 'zoom.json').factor ?? neutral);
    const persist = () => (0, config_1.writeUserConfig)(app, { factor }, 'zoom.json');
    // Guests are tracked in BOTH modes (for the key listener); only `targets()` decides
    // who is actually zoomed.
    const guests = new Set();
    const live = (wc) => !wc.isDestroyed();
    const targets = () => (zoomTarget === 'webviews' ? [...guests] : [win.webContents]).filter(live);
    // Re-apply the current factor to whatever is now loaded, and tell the renderer.
    const apply = () => {
        for (const wc of targets())
            wc.setZoomFactor(factor);
        if (live(win.webContents))
            win.webContents.send('zoom:changed', factor);
    };
    const setFactor = (next) => {
        factor = (0, zoom_ladder_1.clamp)(next);
        apply();
        persist();
    };
    const onKey = (_e, input) => {
        if (input.type !== 'keyDown' || !input.control)
            return;
        const k = input.key;
        if (k === '+' || k === '=')
            setFactor((0, zoom_ladder_1.stepUp)(factor)); // Ctrl+= / Ctrl++ / numpad +
        else if (k === '-')
            setFactor((0, zoom_ladder_1.stepDown)(factor)); // Ctrl+- / numpad -
        else if (k === '0')
            setFactor(neutral); // Ctrl+0 reset → this app's neutral
    };
    win.webContents.on('did-finish-load', apply);
    win.webContents.on('before-input-event', onKey);
    win.webContents.on('did-attach-webview', (_e, guest) => {
        guests.add(guest);
        guest.on('before-input-event', onKey);
        guest.on('destroyed', () => guests.delete(guest));
        if (zoomTarget !== 'webviews')
            return;
        guest.setZoomFactor(factor);
        guest.on('did-finish-load', () => {
            if (live(guest))
                guest.setZoomFactor(factor);
        });
    });
    electron_1.ipcMain.on('zoom:in', () => setFactor((0, zoom_ladder_1.stepUp)(factor)));
    electron_1.ipcMain.on('zoom:out', () => setFactor((0, zoom_ladder_1.stepDown)(factor)));
    electron_1.ipcMain.on('zoom:reset', () => setFactor(neutral));
    electron_1.ipcMain.handle('zoom:get', () => factor);
    electron_1.ipcMain.handle('zoom:neutral', () => neutral);
}
