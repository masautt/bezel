export type BridgeMethods = Record<string, (...args: unknown[]) => unknown>;
/**
 * Expose `window[globalName] = { isElectron, isDev, minimize, maximize, close,
 * zoom, fullscreen, ...extra }` to the renderer via a single contextBridge call.
 * minimize/maximize/close send the 'win:*' channels handled by
 * registerWindowControls; `zoom` is the page-zoom popover bridge; `fullscreen`
 * is the true-fullscreen bridge. Call once from an app's preload.
 */
export declare function exposeShellBridge(globalName: string, extra?: BridgeMethods): void;
