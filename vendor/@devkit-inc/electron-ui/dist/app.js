"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAppIdentity = setAppIdentity;
const electron_1 = require("electron");
const dev_1 = require("./dev");
/**
 * Set the Windows AppUserModelID (taskbar grouping + notifications). When the dev
 * launcher is active (DESKTOP_SHELL_DEV_URL set), a `.dev` suffix gives the live-HMR
 * build its own taskbar identity, separate from the installed app.
 */
function setAppIdentity(baseAppId) {
    electron_1.app.setAppUserModelId((0, dev_1.devServerUrl)() ? `${baseAppId}.dev` : baseAppId);
}
