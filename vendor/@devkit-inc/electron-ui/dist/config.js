"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readUserConfig = readUserConfig;
exports.writeUserConfig = writeUserConfig;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/** Read a JSON config from the app's userData dir. Returns {} on missing/invalid JSON. */
function readUserConfig(app, file = 'config.json') {
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(app.getPath('userData'), file), 'utf-8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Write a JSON config to the app's userData dir (best-effort). */
function writeUserConfig(app, data, file = 'config.json') {
    try {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(app.getPath('userData'), file), JSON.stringify(data, null, 2), 'utf-8');
    }
    catch {
        /* best effort */
    }
}
