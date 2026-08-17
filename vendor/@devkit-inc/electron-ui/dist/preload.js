"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exposeShellBridge = exposeShellBridge;
const electron_1 = require("electron");
/**
 * Expose `window[globalName] = { isElectron, isDev, minimize, maximize, close,
 * zoom, fullscreen, ...extra }` to the renderer via a single contextBridge call.
 * minimize/maximize/close send the 'win:*' channels handled by
 * registerWindowControls; `zoom` is the page-zoom popover bridge; `fullscreen`
 * is the true-fullscreen bridge. Call once from an app's preload.
 */
function exposeShellBridge(globalName, extra = {}) {
    electron_1.contextBridge.exposeInMainWorld(globalName, {
        isElectron: true,
        isDev: !!process.env.DESKTOP_SHELL_DEV_URL,
        minimize: () => electron_1.ipcRenderer.send('win:minimize'),
        maximize: () => electron_1.ipcRenderer.send('win:maximize'),
        close: () => electron_1.ipcRenderer.send('win:close'),
        // Maximized state, so the AppBar can show a restore glyph instead of
        // claiming "Maximize" on an already-maximized window.
        isMaximized: () => electron_1.ipcRenderer.invoke('win:isMaximized'),
        onMaximizeChange: (cb) => {
            const handler = (_e, maximized) => cb(maximized);
            electron_1.ipcRenderer.on('win:maximizedChanged', handler);
            return () => electron_1.ipcRenderer.removeListener('win:maximizedChanged', handler);
        },
        zoom: {
            in: () => electron_1.ipcRenderer.send('zoom:in'),
            out: () => electron_1.ipcRenderer.send('zoom:out'),
            reset: () => electron_1.ipcRenderer.send('zoom:reset'),
            get: () => electron_1.ipcRenderer.invoke('zoom:get'),
            // This app's home factor (ZoomOptions.neutral, default 1). The renderer hides the
            // zoom indicator and counter-scales the AppBar against it, so it has to come from
            // the main process rather than a constant duplicated in the React bundle.
            neutral: () => electron_1.ipcRenderer.invoke('zoom:neutral'),
            onChange: (cb) => {
                const handler = (_e, factor) => cb(factor);
                electron_1.ipcRenderer.on('zoom:changed', handler);
                return () => electron_1.ipcRenderer.removeListener('zoom:changed', handler);
            },
        },
        // True fullscreen (covers the taskbar), as opposed to maximize. Shaped like `zoom`
        // above; optional on the renderer's ShellBridge type so an app on an older
        // electron-ui simply hides the Full screen row instead of throwing.
        fullscreen: {
            toggle: () => electron_1.ipcRenderer.send('win:fullscreen'),
            isFullscreen: () => electron_1.ipcRenderer.invoke('win:isFullscreen'),
            onFullscreenChange: (cb) => {
                const handler = (_e, fullscreen) => cb(fullscreen);
                electron_1.ipcRenderer.on('win:fullscreenChanged', handler);
                return () => electron_1.ipcRenderer.removeListener('win:fullscreenChanged', handler);
            },
        },
        // Theme library + selection, served from masautt-db by registerTheme in main.
        // Every method resolves rather than rejects on failure (main swallows network
        // errors and answers null), so the renderer falls back to the built-in themes
        // instead of having to guard each call. `cachePaint` hands main the resolved
        // CSS for the active theme so the NEXT launch paints it before React mounts —
        // main deliberately does not compute that itself, since resolving a theme
        // means owning the token contract, which lives in @devkit-inc/react-ui.
        theme: {
            list: () => electron_1.ipcRenderer.invoke('theme:list'),
            getSelection: () => electron_1.ipcRenderer.invoke('theme:getSelection'),
            setSelection: (selection) => electron_1.ipcRenderer.invoke('theme:setSelection', selection),
            cachePaint: (css) => electron_1.ipcRenderer.invoke('theme:cachePaint', css),
        },
        ...extra,
    });
}
