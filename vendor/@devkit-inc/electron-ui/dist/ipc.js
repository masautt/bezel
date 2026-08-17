"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWindowControls = registerWindowControls;
const electron_1 = require("electron");
/**
 * Wire 'win:minimize' / 'win:maximize' (toggle) / 'win:close' to this window,
 * plus the maximized-state channels the AppBar's restore icon reads:
 * 'win:isMaximized' (invoke, for initial state) and 'win:maximizedChanged'
 * (push, on every transition); plus the fullscreen triad: 'win:fullscreen'
 * (toggle), 'win:isFullscreen' (invoke, for initial state), and
 * 'win:fullscreenChanged' (push, on every transition).
 *
 * Without the state channels the maximize button is a static glyph that cannot
 * know whether it maximized or restored the window, so it kept reading
 * "Maximize" while the window was already maximized.
 */
function registerWindowControls(win) {
    electron_1.ipcMain.on('win:minimize', () => win.minimize());
    electron_1.ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
    electron_1.ipcMain.on('win:close', () => win.close());
    electron_1.ipcMain.on('win:fullscreen', () => win.setFullScreen(!win.isFullScreen()));
    // `handle` throws if a channel is registered twice; a second window — or a
    // re-registration during a dev reload — would otherwise crash main.
    electron_1.ipcMain.removeHandler('win:isMaximized');
    electron_1.ipcMain.handle('win:isMaximized', () => win.isMaximized());
    electron_1.ipcMain.removeHandler('win:isFullscreen');
    electron_1.ipcMain.handle('win:isFullscreen', () => win.isFullScreen());
    const pushMaximized = () => {
        if (win.isDestroyed() || win.webContents.isDestroyed())
            return;
        win.webContents.send('win:maximizedChanged', win.isMaximized());
    };
    // The fullscreen value is passed in rather than re-read from win.isFullScreen() here:
    // measured on Windows (sbrain-desktop's verify:fullscreen gate, driving a real frameless
    // window), win.isFullScreen() is STALE by exactly one tick at the instant 'enter-full-screen'
    // / 'leave-full-screen' fire — reading it synchronously inside these handlers returned the
    // PRE-transition value every time (false on enter, true on leave), which pushed an inverted
    // flag to the renderer and left the fullscreen auto-hide app bar backwards: visible while
    // fullscreen, hidden once restored. A setImmediate/setTimeout(0) deferral also "fixes" it
    // (the flag is correct one tick later) but is unnecessary and slower — the event name IS the
    // ground truth for which state the window just entered, so use that directly instead of
    // asking a flag that has not caught up yet.
    const pushFullscreen = (fullscreen) => {
        if (win.isDestroyed() || win.webContents.isDestroyed())
            return;
        win.webContents.send('win:fullscreenChanged', fullscreen);
    };
    // Full-screen pushes BOTH, from a single combined listener per event rather than
    // two separate win.on registrations: it is the other way a window stops being
    // restorable by the maximize glyph, and it is the fullscreen state's own source
    // of truth, and a single listener keeps one handler per event (as maximize /
    // unmaximize already do) instead of firing the pair out of registration order.
    const pushFullscreenTransition = (fullscreen) => {
        pushMaximized();
        pushFullscreen(fullscreen);
    };
    // Listed one by one rather than looped: BrowserWindow.on is a union of
    // per-event overloads, so a loop variable does not typecheck against it.
    win.on('maximize', pushMaximized);
    win.on('unmaximize', pushMaximized);
    win.on('enter-full-screen', () => pushFullscreenTransition(true));
    win.on('leave-full-screen', () => pushFullscreenTransition(false));
}
