"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devServerUrl = devServerUrl;
/**
 * The dev launcher sets DESKTOP_SHELL_DEV_URL to the Vite dev server URL so the
 * Electron window loads it (with HMR) instead of booting the bundled server.
 * Returns null in production (env unset/empty).
 */
function devServerUrl() {
    return process.env.DESKTOP_SHELL_DEV_URL || null;
}
