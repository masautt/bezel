"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultOrgsRoot = void 0;
exports.listThemes = listThemes;
exports.resolveSelectionRows = resolveSelectionRows;
exports.getSelection = getSelection;
exports.setSelection = setSelection;
exports.themedBaseStyles = themedBaseStyles;
exports.registerTheme = registerTheme;
const electron_1 = require("electron");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const config_1 = require("./config");
/**
 * Theme library + selection, backed by sbrain_config.themes and
 * sbrain_config.preferences in masautt-db.
 *
 * This lives in MAIN, not in the renderer, because the credentials file holds a
 * service-role key. bezel's specs-service established that rule and this follows
 * it: the key is read here, used here, and never handed across the bridge.
 *
 * Talks PostgREST over plain fetch rather than pulling in @supabase/supabase-js.
 * Two GETs and one upsert do not justify adding the SDK to a package whose only
 * runtime dependencies today are build tooling — and every consumer app would
 * inherit the weight.
 */
/** Same shared-.config convention specs-service reads. */
const credsPath = (orgsRoot) => (0, node_path_1.join)(orgsRoot, 'sbrain-inc', '.config', 'supabase-creds.json');
/** `~/source/orgs`, derived rather than hardcoded so another machine still works. */
const defaultOrgsRoot = () => (0, node_path_1.join)((0, node_os_1.homedir)(), 'source', 'orgs');
exports.defaultOrgsRoot = defaultOrgsRoot;
let creds;
function getCreds(orgsRoot) {
    if (creds !== undefined)
        return creds;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(credsPath(orgsRoot), 'utf-8'));
        creds = parsed?.url && parsed?.serviceRoleKey ? parsed : null;
    }
    catch {
        creds = null;
    }
    return creds;
}
/** PostgREST needs the non-public schema named explicitly on every request. */
const headers = (c, write = false) => ({
    apikey: c.serviceRoleKey,
    Authorization: `Bearer ${c.serviceRoleKey}`,
    'Content-Type': 'application/json',
    [write ? 'Content-Profile' : 'Accept-Profile']: 'sbrain_config',
});
/** Bounded so a hung network cannot delay a window that is otherwise ready. */
const TIMEOUT_MS = 6000;
/**
 * Every network failure mode — offline, no credentials, DNS, timeout, non-2xx —
 * collapses to `ok: false`. The caller falls back to the built-in themes; this
 * never throws into main.
 *
 * `ok` is reported separately from `body` rather than folded into a null return:
 * a successful write uses `Prefer: return=minimal` and answers with an EMPTY
 * body, so "no body" and "request failed" are genuinely different outcomes and a
 * single nullable return cannot tell them apart.
 */
async function request(url, init) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...init, signal: abort.signal });
        if (!res.ok)
            return { ok: false, body: null };
        const text = await res.text();
        return { ok: true, body: text ? JSON.parse(text) : null };
    }
    catch {
        return { ok: false, body: null };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Live theme rows, or null when the library is unreachable. */
async function listThemes(orgsRoot = (0, exports.defaultOrgsRoot)()) {
    const c = getCreds(orgsRoot);
    if (!c)
        return null;
    const select = 'id,label,type,colors,sort_order,updated_at,deleted_at';
    // Tombstones are fetched too, not filtered out server-side: mergeRemoteThemes
    // needs to SEE a tombstone to drop a theme the local cache still holds. A
    // deleted_at=is.null filter would make deletions invisible to a cached client.
    const { body } = await request(`${c.url}/rest/v1/themes?select=${select}&order=sort_order.asc`, { headers: headers(c) });
    return body;
}
/**
 * Pick the row that applies: an app-specific row wins over the global `'*'` row.
 *
 * The global row is the normal case and the reason the table is keyed this way —
 * one choice follows the user across masaudit, localhub, bezel and sbrain. The
 * per-app override exists for the app you deliberately want to look different.
 *
 * Pure and exported so the precedence is testable without a network, the same
 * way bezel keeps mergeRemotePresets separate from its transport.
 */
function resolveSelectionRows(rows, app) {
    if (!rows?.length)
        return null;
    const match = rows.find((r) => r.app === app) ?? rows.find((r) => r.app === '*');
    return match?.value ?? null;
}
/** The stored selection for `app`, or null when unreachable or unset. */
async function getSelection(app, orgsRoot = (0, exports.defaultOrgsRoot)()) {
    const c = getCreds(orgsRoot);
    if (!c)
        return null;
    const scope = `in.("${app}","*")`;
    const { body: rows } = await request(`${c.url}/rest/v1/preferences?select=app,value&key=eq.theme&app=${encodeURIComponent(scope)}`, { headers: headers(c) });
    return resolveSelectionRows(rows, app);
}
/**
 * Persist the selection. `scope` defaults to '*' so choosing a theme in any app
 * moves all of them — that is the behaviour the picker is for. Pass the app name
 * to pin one app instead.
 */
async function setSelection(selection, scope = '*', orgsRoot = (0, exports.defaultOrgsRoot)()) {
    const c = getCreds(orgsRoot);
    if (!c)
        return false;
    const { ok } = await request(`${c.url}/rest/v1/preferences`, {
        method: 'POST',
        headers: {
            ...headers(c, true),
            // Upsert. Without merge-duplicates a second machine's write is a 409.
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify([{ app: scope, key: 'theme', value: selection }]),
    });
    return ok;
}
/**
 * The cached first-paint CSS, as a base-styles fragment.
 *
 * Electron holds the window hidden until ready-to-show, but React still mounts
 * after first paint — so without this the window opens on the stylesheet default
 * (dark) and snaps to the user's theme a frame later. The renderer hands main the
 * resolved CSS whenever the theme changes (`theme:cachePaint`); main replays it
 * into the next launch before the bundle runs.
 *
 * The CSS is stored opaquely rather than recomputed here on purpose: resolving a
 * theme means owning the token contract and the base palettes, which live in
 * @devkit-inc/react-ui. Duplicating them in main is how the two would drift.
 */
function themedBaseStyles(app, base) {
    const { themeCss } = (0, config_1.readUserConfig)(app);
    if (!themeCss)
        return base;
    // The cached rule carries its own color-scheme, so drop the hardcoded dark one
    // rather than letting it fight — otherwise light themes keep dark native
    // scrollbars, form controls and caret.
    return `${base.replace(/:root\s*\{\s*color-scheme:\s*dark;\s*\}\s*/, '')}\n${themeCss}`;
}
/**
 * Wire the `theme:*` channels the renderer's ThemeBridge calls. Call once beside
 * registerWindowControls(win).
 */
function registerTheme(win, opts) {
    const orgsRoot = opts.orgsRoot ?? (0, exports.defaultOrgsRoot)();
    const scope = opts.scope ?? '*';
    // removeHandler first: `handle` throws on a duplicate channel, which a second
    // window or a dev reload would otherwise turn into a crash in main.
    electron_1.ipcMain.removeHandler('theme:list');
    electron_1.ipcMain.handle('theme:list', () => listThemes(orgsRoot));
    electron_1.ipcMain.removeHandler('theme:getSelection');
    electron_1.ipcMain.handle('theme:getSelection', () => getSelection(scope, orgsRoot));
    electron_1.ipcMain.removeHandler('theme:setSelection');
    electron_1.ipcMain.handle('theme:setSelection', (_e, selection) => setSelection(selection, scope, orgsRoot));
    electron_1.ipcMain.removeHandler('theme:cachePaint');
    electron_1.ipcMain.handle('theme:cachePaint', (_e, css) => {
        if (typeof css !== 'string' || css.length > 64_000)
            return false;
        const current = (0, config_1.readUserConfig)(opts.app);
        if (current.themeCss === css)
            return true;
        (0, config_1.writeUserConfig)(opts.app, { ...current, themeCss: css });
        return true;
    });
    // Nothing to tear down on close: the handlers are keyed by channel and the next
    // window re-registers them, matching how registerWindowControls behaves.
    void win;
}
