import { BrowserWindow } from 'electron';
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
export declare function registerWindowControls(win: BrowserWindow): void;
