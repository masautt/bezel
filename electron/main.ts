import { app, BrowserWindow, clipboard, ipcMain, shell, utilityProcess } from 'electron'
import path from 'path'
import { homedir } from 'os'
import { existsSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { spawn } from 'child_process'
import { createShellWindow, registerWindowControls, registerZoom, devServerUrl, setAppIdentity, readUserConfig, registerTheme, themedBaseStyles, DEFAULT_BASE_STYLES } from '@devkit-inc/electron-ui'
// node-pty is deliberately NOT imported here any more: it lives in the utility
// process (pty-host.ts), and main only talks to it through this proxy.
import { createPtyBridge, type PtyBridge, type HostHandle } from './pty-bridge.js'
import { registerPtyIpc } from './pty-ipc.js'
import { revealWindow } from './single-instance.js'
import { sendToWindow } from './send-to-window.js'
import { installCrashHandlers, formatCrash } from './crash-handlers.js'
import { resolvePwshOnPath, pwshProbe } from './resolve-shell.js'
import { createReloadLimiter } from './reload-limiter.js'
// Only the WRITER side is main's business now; the host owns reading it.
import { normalizePaneTheme } from './pane-theme.js'
import { scanApps } from './apps-service.js'
import { gitInfo } from './git-service.js'
import { createGitCache } from './git-cache.js'
import { fetchUsage, initUsageCache } from './usage-service.js'
import { readContextMeter } from './context-service.js'
import { listSpecs, resolveSpecTarget, readSpecsRegistry } from './specs-service.js'
import { patchConfig } from './config-patch.js'
import { writeJsonAtomic } from './config-write.js'
import { createConfigQueue, type ConfigQueue } from './config-queue.js'
import { pullPresets, pushPresets, tombstonePreset } from './presets-service.js'
import { pullLoadingMessages } from './loading-messages-service.js'
import { resolveOpenFileAction } from './open-file-service.js'
// A relative import, not the `@shared` alias — see the note in
// specs-service.ts: tsc does not rewrite path-mapped specifiers on emit.
import { resolveLastCwd, resolveLastRepoRoot } from '../src/paths.js'
import { sessionTranscriptPaths } from '../src/context-meter.js'
import { deriveRoots } from '../src/roots.js'
// PaneKey and SessionIntent left with the pty handlers when they moved to
// pty-ipc.ts — nothing else in main names either type.
import type { AppEntry } from '@shared/types.js'
import type { LayoutPreset } from '../src/presets.js'

// Derived from the real home directory, once, and shared with the renderer through
// the preload (src/roots.ts). Previously this literal appeared here and in two
// renderer components, which meant bezel only ran for one username.
const HOME = homedir()
const ROOTS = deriveRoots(HOME)
const ORGS_ROOT = ROOTS.orgsRoot

/** Everything bezel persists to userData/config.json. */
interface BezelConfig {
  lastCwd?: string
  lastRepoRoot?: string
  /** The serialized LayoutStore. Stored opaquely — parseStore repairs it in
   *  the renderer, which is where the browser-safe reducers live. */
  layout?: unknown
  /** The serialized PersistedTabs. Opaque for the same reason as `layout`:
   *  parseTabs repairs it in the renderer. */
  tabs?: unknown
}

let win: BrowserWindow | null = null

/**
 * How long to sit on a remembered-path write before committing it.
 *
 * `project:remember` fires on every shell prompt, and its value is read exactly
 * once — at the next launch. A second is long enough to collapse a burst of
 * `cd`s into one write and far shorter than the gap between a user's last
 * keystroke and their quitting the app. `before-quit` flushes it regardless.
 */
const REMEMBER_DEBOUNCE_MS = 1000

/** Assigned in `whenReady`; flushed by `before-quit`. */
let projectQueue: ConfigQueue<BezelConfig> | null = null

// How long to wait before spawning the idle spares that make a new tab open
// instantly. Long enough for the window's own panes to get through their boot
// first — see the prewarm call at the end of whenReady for why that ordering
// matters more than having spares ready a few seconds sooner.
const PREWARM_DELAY_MS = 8000

/**
 * How long one git reading is reused.
 *
 * Sized to the gap between two widgets asking for the same root — they mount
 * together and land milliseconds apart — not to their 10s poll interval. Long
 * enough to collapse the pair, short enough that nothing a user does in the
 * shell pane stays invisible for a noticeable time.
 */
const GIT_CACHE_MS = 1500

// pwsh.exe (PowerShell 7) is the intended shell — the user's `csource` function
// is defined in its profile — but fall back to Windows PowerShell rather than
// failing to spawn at all. See resolve-shell.ts for why the probe is lstat and
// not existsSync; getting that wrong demotes an MSIX-installed pwsh.
const pwshPath = resolvePwshOnPath(process.env.PATH, pwshProbe)
const shellPath = pwshPath ? 'pwsh.exe' : 'powershell.exe'
// Windows PowerShell loads a different profile, so the shell pane's prompt and
// the user's functions are missing there. (The claude pane no longer depends on
// the profile to START — see buildClaudeCommand — but it does dot-source it once
// claude exits.) A silent fallback leaves the panes subtly wrong with no
// explanation, so surface it as the first line the user sees in each pane.
const fallbackWarning = pwshPath
  ? undefined
  : 'PowerShell 7 (pwsh.exe) not found on PATH — falling back to Windows PowerShell. Your pwsh 7 profile (csource, prompt theme) is not loaded here.'
// The prompt theme channel. A bare one-word file rather than a key in
// config.json: the shell pane's prompt re-reads it on EVERY render, and
// `Get-Content -Raw` on eight bytes is a cost that can be ignored where a
// ConvertFrom-Json per keystroke is not. See pane-theme.ts for why the channel
// exists at all.
//
// Resolved at module scope, which is safe here because getPath('userData') does
// not need the ready event and setAppIdentity() only sets the AppUserModelID —
// nothing in this app moves userData out from under this path.
const PANE_THEME_FILE = path.join(app.getPath('userData'), 'pane-theme')

// The pane-theme READER moved to pty-host.ts along with the manager that used
// it: PaneThemeSource is `{ file, read() }` so it can be satisfied wherever the
// manager is hosted, and the host reads the file locally rather than asking main
// for eight bytes. main still WRITES the file — see the `panes:theme` handler.

/**
 * The pty host, assigned in `whenReady`.
 *
 * Module-scope `let` rather than a const built here, because
 * `utilityProcess.fork` is only legal after the app is ready — and because the
 * point of the whole exercise is that main never touches node-pty again. The
 * ~5.1s first-spawn block now lands in a process nobody is waiting on, instead
 * of on the thread that owns the window's message loop.
 */
let ptyManager: PtyBridge | null = null

/** The bridge, or a loud failure if something reaches it before `whenReady`. */
function pty(): PtyBridge {
  if (!ptyManager) throw new Error('the pty host has not been started yet')
  return ptyManager
}

// Installed before anything else can throw, and before whenReady: a fault
// during startup is exactly the one nobody can otherwise diagnose, since there
// is no window yet to show it in. `getPath('userData')` does not need the ready
// event (same reasoning as PANE_THEME_FILE above).
//
// Appended, never truncated: how OFTEN something happens is most of the signal,
// and a log that keeps only the last crash cannot answer that.
const CRASH_LOG = path.join(app.getPath('userData'), 'crash.log')
const logCrash = (line: string) => { appendFileSync(CRASH_LOG, line + '\n') }
installCrashHandlers(process, logCrash)

// Claim the single-instance lock BEFORE whenReady. A second launch must exit before it forks
// a pty host or creates a window — both of which are expensive and, in the failure this exists
// for, invisible. `app.quit()` alone is not enough this early: quit unwinds through the normal
// lifecycle and a losing instance that has already started work can outlive it, so `exit(0)`
// ends it outright. Nothing of ours has run yet at this point, so there is nothing to unwind.
if (!app.requestSingleInstanceLock()) app.exit(0)

// The first instance hears about every later launch here, and answers it by surfacing the
// window it already owns. See revealWindow: a never-shown window needs show(), not restore().
app.on('second-instance', () => revealWindow(win))

app.whenReady().then(async () => {
  setAppIdentity('com.masautt.bezel')
  // Fork the pty host FIRST. Everything downstream — the window, the panes, the
  // prewarm below — depends on it, and forking costs main nothing: the child
  // pays the ~5.1s node-pty initialisation on its own thread while main gets on
  // with painting a window the user can actually use.
  //
  // Cast because Electron types `UtilityProcess.postMessage(message: any)` and
  // an overloaded `on`; HostHandle narrows both to the protocol. The cast is
  // the only place the two vocabularies meet.
  ptyManager = createPtyBridge(() => utilityProcess.fork(path.join(__dirname, 'pty-host.js')) as unknown as HostHandle, {
    shellPath,
    fallbackWarning,
    paneThemeFile: PANE_THEME_FILE,
  })
  // NOTE: there is deliberately no prewarm here.
  //
  // There used to be one, at the remembered launch cwd, reasoning that spares
  // should sit where the FIRST tab opens. It never ran: `schedulePrewarm` clears
  // any pending timer, and the sourceRoot prewarm at the end of this function
  // always lands well inside the 8s delay (loadFile is sub-second). The first
  // tab spawns immediately at launch anyway, seconds before any spare could
  // exist, so nothing was lost — but in the one case the timer DID win, it
  // produced spares at a path `takeWarm` then rejected on cwd, which is a spawn
  // paid for and thrown away. The pool serves NEW tabs, and those always open at
  // sourceRoot.
  //
  // Before anything else touches the main thread: load the last run's usage
  // snapshot off disk and start a refresh against it. The Usage widget's request
  // cannot be answered until main is out of its synchronous pty spawns — several
  // seconds in — so without this the meter reads "reading…" for the whole of
  // every launch. The disk read is one small local file and the fetch is network
  // I/O that proceeds while the main thread is blocked, so both are effectively
  // free here and land before the renderer's first poll.
  initUsageCache(app.getPath('userData'))
  void fetchUsage(HOME).catch(() => { /* best-effort prewarm; the poll retries */ })
  // The window/taskbar icon. Without this, createShellWindow passes `icon:
  // undefined` to BrowserWindow and Windows falls back to Electron's default
  // atom — which is what a `npm run electron:dev` launch showed, even though
  // build/icon.ico was correct all along and electron-builder was embedding it
  // in the packaged exe. Both sibling apps (localhub, storybook) pass this; bezel
  // was the one that never did.
  //
  // .ico, not the .png beside it: an .ico carries several resolutions, so the
  // 16px title bar and the larger taskbar/alt-tab slots each get a bitmap made
  // for them instead of one downscale.
  //
  // __dirname is dist-electron/electron/, hence two levels up to the repo root.
  // Guarded by existsSync because build/ is NOT in electron-builder's `files`:
  // in the PACKAGED app this path does not resolve, and passing a dead path
  // would lose the exe icon that electron-builder already embedded from this
  // very file. Absent `icon`, the window inherits that exe icon — the same
  // image — so dev and installed agree.
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.ico')
  win = createShellWindow({
    backgroundColor: '#0d1117',
    preload: path.join(__dirname, 'preload.js'),
    // Replays the active theme's resolved CSS into first paint, so a light or
    // Monokai window does not open on the dark default and snap over a frame
    // later. Falls back to DEFAULT_BASE_STYLES verbatim before any theme has
    // been chosen on this machine.
    baseStyles: themedBaseStyles(app, DEFAULT_BASE_STYLES),
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
  })
  win.on('closed', () => { win = null })
  registerWindowControls(win)
  // Scope defaults to '*', so picking a theme here moves masaudit, localhub and
  // sbrain-desktop too — one choice per user, not per app.
  registerTheme(win, { app, orgsRoot: ORGS_ROOT })

  // createShellWindow (electron-ui/dist/window.js) registers a single anonymous
  // 'before-input-event' listener binding F5 and Ctrl+R to webContents.reload(),
  // plus Alt+Left/Right to history navigation. In an app whose panes forward
  // keystrokes to live shells, a global reload accelerator is a hazard, not a
  // convenience: Ctrl+R belongs to PSReadLine's reverse-history-search, and a
  // reload here tears down and re-boots every terminal in the window (see
  // did-start-navigation below). Tab set persistence made that survivable —
  // the tabs come back — but it is still a full restart of the active tab's
  // shell and a cold `--resume` of its claude, which is not what a user
  // reaching for reverse search is asking for.
  // The Alt+Left/Right removal is incidental and harmless: bezel is a single-page
  // app whose AppBar renders with nav={false} and never navigates.
  // Must run BEFORE registerZoom (below), which adds its OWN 'before-input-event'
  // listener for Ctrl +/-/0 page zoom (electron-ui/dist/zoom.js) — removing after
  // registerZoom would silently kill keyboard zoom too. The library exposes no way
  // to unbind just the reload/history handler, so this is a blanket removal.
  win.webContents.removeAllListeners('before-input-event')

  // bezel opens at 125%, not the fleet-wide 100%: these are terminals read for hours at
  // a time, and the pane text at 100% is a notch small on this display. `neutral` (not a
  // one-time seeded zoom.json) so Ctrl+0 and the popover's Reset come back HERE — a
  // default you cannot return to is not a default. The renderer picks the same value up
  // over the bridge's zoom.neutral(), so the indicator stays hidden at home and the
  // AppBar counter-scales against 1.25 rather than shrinking itself to 1x.
  // A zoom.json the user has already zoomed into still wins; this is only the start.
  registerZoom(win, { app, neutral: 1.25 })

  // createShellWindow binds F5 / Ctrl+R to webContents.reload() unconditionally
  // (packaged builds included — Ctrl+R also happens to be PSReadLine's reverse
  // search, so hitting it inside the shell pane by accident is easy) — and
  // `render-process-gone` below now calls it deliberately.
  //
  // A reload no longer starts from `createInitialTabs`: the renderer reads the
  // persisted set back and RESTORES it, which is the whole premise of the
  // reload-on-crash path. That does not make this teardown unnecessary, it
  // makes it more necessary. Restore is lazy — only the active tab boots, and
  // every other tab comes back DORMANT with no pane mounted. Those tabs'
  // pre-reload ptys are still alive in the manager's Map, with no renderer
  // listening and nothing able to kill them until app quit. (The ACTIVE tab is
  // covered either way — spawn() already kills whatever pty holds the key it
  // is given — so it is the dormant majority that would leak, and the set is
  // now allowed to be large.) Killing everything on the main frame's
  // navigation start closes that gap; it is a no-op on the initial load, when
  // the map is still empty.
  // `isSameDocument` excludes hash changes and history.pushState, which replace
  // no document and leave the renderer's tab state — and its ptys — intact.
  // Inert today (bezel has no router, hash links, or iframes), but the first one
  // added would otherwise kill every terminal in every tab on a click.
  win.webContents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) pty().killAll()
  })

  // sendToWindow, not `win?.webContents.send`: the optional chain only covers
  // `win` being nulled by the `closed` handler, and webContents is destroyed
  // BEFORE that fires. The host keeps streaming through the SHUTDOWN_MS window
  // that before-quit holds open, so a send into a dead webContents on the way
  // out was a real throw on the main thread — which, before the crash handlers
  // above, exited the app in a way that looked like a clean quit and orphaned
  // the pwsh grandchildren the wait exists to reap.
  pty().onData((key, data) => sendToWindow(win, 'pty:data', key, data))
  pty().onExit((key, code) => sendToWindow(win, 'pty:exit', key, code))

  // The two crashes the handlers above CANNOT see: a renderer or a child
  // process dying is not an exception on the main thread, it is an event. Both
  // present identically to the user (panes stop responding), and neither left
  // any trace at all before this.
  const reloads = createReloadLimiter()
  win.webContents.on('render-process-gone', (_e, details) => {
    logCrash(formatCrash('render-process-gone', `${details.reason} (exitCode ${details.exitCode})`, new Date().toISOString()))
    // Reload rebuilds the window AND reaps the orphaned ptys: it fires
    // did-start-navigation, which already calls killAll. The tab set is on
    // disk, so the workspace comes back with it — that is what made this safe
    // to do at all.
    if (!win || win.isDestroyed()) return
    if (!reloads.allow()) {
      logCrash(formatCrash('reload-limit', 'too many renderer crashes; not reloading', new Date().toISOString()))
      return
    }
    win.reload()
  })
  app.on('child-process-gone', (_e, details) => {
    logCrash(formatCrash('child-process-gone', `${details.type}: ${details.reason} (exitCode ${details.exitCode})`, new Date().toISOString()))
  })

  // Writes go one-way; spawn/resize/kill keep their replies. See pty-ipc.ts for
  // which is which and why — and for why a throwing write has to be caught
  // there rather than left to the crash handlers above.
  registerPtyIpc(ipcMain, pty, err => logCrash(formatCrash('pty:write', err, new Date().toISOString())))

  // Pushed by the renderer whenever the registry applies a theme. Normalized to
  // one of two literals before it is written, because this value ends up
  // interpolated into a live shell's environment — see pane-theme.ts.
  ipcMain.handle('panes:theme', (_e, theme: unknown) => {
    mkdirSync(path.dirname(PANE_THEME_FILE), { recursive: true })
    writeFileSync(PANE_THEME_FILE, normalizePaneTheme(theme), 'utf-8')
    // The SHELL spares baked the old theme into their environment at spawn and
    // cannot be re-themed in place, so restarting the fill reaps and rebuilds
    // them; doing it here rather than lazily means the next tab gets a warm
    // pane instead of falling back to a cold spawn.
    //
    // The claude spares survive this — see isFit in pty-manager.ts. They are
    // the expensive half of the pool (tens of seconds of MCP connector
    // handshakes each) and nothing in a claude pane reads BEZEL_THEME until
    // claude exits, so discarding them re-coloured a prompt the user could not
    // yet see and charged the next few new tabs a cold start for it.
    pty().prewarm(ROOTS.sourceRoot, PREWARM_DELAY_MS)
  })

  // The scan walks ~230 repos; cache it for the session and refresh on demand.
  //
  // The PROMISE is cached, not the resolved array, which dedupes for free: two
  // widgets mounting in the same frame get one walk between them rather than
  // two. (scanApps guards every fs call individually and resolves to a possibly
  // short list rather than rejecting, so there is no failed promise to evict.)
  let appsCache: Promise<AppEntry[]> | null = null
  ipcMain.handle('apps:list', (_e, refresh = false) => {
    if (refresh || !appsCache) appsCache = scanApps(ORGS_ROOT)
    return appsCache
  })

  // Two widgets poll this for the same root on their own 10s timers, and both
  // mount together — so every reading was taken twice, milliseconds apart. The
  // window is far shorter than that interval on purpose: it collapses
  // simultaneous readers without making the Changes list lag behind a commit
  // the user just made in the shell pane.
  const gitCache = createGitCache(gitInfo, Date.now, GIT_CACHE_MS)
  ipcMain.handle('git:info', (_e, root: string) => gitCache.get(root))

  // Both of these read state that belongs to Claude Code, not to bezel, and both
  // stay in main for the same reason: the renderer has no filesystem, and the
  // usage call is authorized by an OAuth token that must never be exposed on the
  // bridge. What crosses is the finished reading and nothing else.
  ipcMain.handle('usage:get', () => fetchUsage(HOME))
  // sessionId is the tab's own claude session when bezel assigned one. Absent
  // for a claude the user started by hand in the shell pane, where the
  // newest-transcript heuristic remains the best available reading.
  ipcMain.handle('context:meter', (_e, cwd: string, sessionId?: string) => readContextMeter(HOME, cwd, Date.now(), sessionId))

  ipcMain.handle('specs:list', (_e, org: string, project: string) => listSpecs(org, project))

  // Opening a spec is a filesystem question — is the generated .html on this box? —
  // and the renderer has no filesystem access, so the decision lives here rather
  // than in the widget. shell.openPath hands the local file to the default browser,
  // which RENDERS it; GitHub's blob view would show the HTML as source.
  ipcMain.handle('specs:open', async (_e, org: string, htmlPath: string) => {
    const target = resolveSpecTarget(org, htmlPath, readSpecsRegistry(), existsSync)
    if (target.kind === 'local') await shell.openPath(target.path)
    else await shell.openExternal(target.url)
    return target.kind
  })

  // Every write goes through patchConfig: a write replaces the whole file, and
  // `project:remember` fires on every shell prompt — with two keys in
  // config.json a plain write would erase the other one several times a minute.
  //
  // writeJsonAtomic rather than electron-ui's writeUserConfig: that one
  // truncates and then writes, and this file holds every layout preset the user
  // has built. Same path, same best-effort contract, without the window in
  // which a crash leaves it half-written. (readUserConfig is still the
  // library's — reading was never the problem.)
  const patchUserConfig = (patch: Partial<BezelConfig>) =>
    patchConfig<BezelConfig>(
      () => readUserConfig<BezelConfig>(app),
      next => writeJsonAtomic(path.join(app.getPath('userData'), 'config.json'), next),
      patch
    )

  // The remembered-path writes are coalesced; nothing else is. `remember` fires
  // on every prompt and its value is only ever read once, at the next launch, so
  // a burst of `cd`s is worth exactly one write. A layout save is user-initiated
  // and rare, and goes straight through below.
  projectQueue = createConfigQueue<BezelConfig>(patchUserConfig, REMEMBER_DEBOUNCE_MS)

  ipcMain.handle('project:remember', (_e, cwd: string) => { projectQueue?.patch({ lastCwd: cwd }) })
  // Separate from `project:remember` rather than a second argument to it: the
  // two fire on different events. `remember` fires on every prompt, this only
  // when the resolved repo root actually changes.
  ipcMain.handle('project:rememberRepo', (_e, root: string) => { projectQueue?.patch({ lastRepoRoot: root }) })
  // Restoring a stale path (renamed/deleted repo) would wedge every future
  // launch at a nonexistent cwd with no in-app recovery, so both stored values
  // only win if they still exist on disk.
  ipcMain.handle('project:last', () => {
    const cfg = readUserConfig<BezelConfig>(app)
    return {
      cwd: resolveLastCwd(cfg.lastCwd, existsSync, ROOTS.sourceRoot),
      repoRoot: resolveLastRepoRoot(cfg.lastRepoRoot, existsSync),
    }
  })
  // Checked before a restored tab spawns: bezel now survives a spawn at a
  // deleted cwd (error code 267), but surviving a failure is not a reason to
  // walk into one, and silently repointing the tab at a fallback root would
  // misrepresent which workspace you were looking at.
  ipcMain.handle('project:exists', (_e, p: string) => existsSync(p))

  // Whether a remembered claude session actually has a conversation on disk.
  //
  // bezel assigns the id at spawn, but claude does not create the conversation
  // until it has content — so a tab you opened and never typed in carries an id
  // that resolves to nothing. Restoring it ran `--resume <uuid>` against a
  // session that was never written and printed "No conversation found with
  // session ID". The failed-resume heuristic could not save it either: claude
  // PRINTS that error rather than exiting silently, so the no-bytes half of the
  // rule was false and the branch never fired.
  //
  // The claude pane is rooted at CSOURCE_DIR (else ~/source) rather than the
  // tab's cwd — see buildClaudeCommand — so that root is checked first, with
  // the tab's own cwd and its ancestors behind it for a session started
  // elsewhere.
  ipcMain.handle('session:exists', (_e, sessionId: string, cwd: string) => {
    const claudeRoot = process.env.CSOURCE_DIR || ROOTS.sourceRoot
    const candidates = [
      ...sessionTranscriptPaths(HOME, claudeRoot, sessionId),
      ...sessionTranscriptPaths(HOME, cwd, sessionId),
    ]
    return candidates.some(existsSync)
  })

  // Clipboard goes through main rather than navigator.clipboard: the renderer
  // would need a permission grant for reads, and every other OS-level capability
  // in this app already lives here.
  ipcMain.handle('clipboard:write', (_e, text: string) => { clipboard.writeText(text) })
  ipcMain.handle('clipboard:read', () => clipboard.readText())

  // Rides the SAME queue as project:remember rather than a second one: patch()
  // merges, so a tab change and a `cd` landing in the same second collapse into
  // one atomic write, and before-quit's flush already covers both.
  ipcMain.handle('tabs:remember', (_e, set: unknown) => { projectQueue?.patch({ tabs: set }) })
  // Returns `unknown` on purpose, exactly as layout:load does: the repair
  // (parseTabs) lives in src/, and a precise type here would invite trusting a
  // hand-edited config.json.
  ipcMain.handle('tabs:last', () => readUserConfig<BezelConfig>(app).tabs ?? null)

  // Returns `unknown` on purpose: the repair (parseStore) lives in src/, which is
  // browser-safe and shared, and a precise type here would invite trusting a
  // hand-edited config.json.
  ipcMain.handle('layout:load', () => readUserConfig<BezelConfig>(app).layout ?? null)
  ipcMain.handle('layout:save', (_e, store: unknown) => patchUserConfig({ layout: store }))

  // Preset sync is best-effort and never blocks: the local config.json copy above
  // is authoritative for everything that renders. The merge policy itself is
  // `mergeRemotePresets` in src/presets.ts, run in the renderer — this side only
  // does I/O.
  // Refreshes the loading screen's text for the NEXT launch. The renderer calls
  // this only once its panes are alive: anything it sends while main is inside a
  // synchronous nodePty.spawn queues behind it, so a pull issued during the
  // loading screen could not answer until the loading screen was already gone.
  ipcMain.handle('loading:pull', () => pullLoadingMessages())

  ipcMain.handle('presets:pull', () => pullPresets())
  ipcMain.handle('presets:push', (_e, presets: LayoutPreset[]) => pushPresets(presets))
  ipcMain.handle('presets:tombstone', (_e, id: string, now: string) => tombstonePreset(id, now))

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url)
    return undefined
  })

  // Ctrl+clicking a file path in a terminal pane. `code -g` is the only form that
  // honours the line number, so it is tried first; shell.openPath is the fallback
  // for a box with no `code` on PATH, and it loses the line.
  //
  // Spawned through cmd.exe rather than `shell: true` because the CLI is
  // `code.cmd` — Node refuses to spawn a .cmd directly, and `shell: true` would
  // splice the path into a command line unescaped. Node applies cmd-specific
  // quoting when the executable IS cmd.exe, which this relies on.
  ipcMain.handle('shell:openFile', (_e, target: { path: string; line?: number; col?: number }) => {
    if (!target || typeof target.path !== 'string') return false
    const action = resolveOpenFileAction(target.path, target.line, target.col, existsSync)
    if (action.kind === 'none') return false
    try {
      const child = spawn(process.env.COMSPEC || 'cmd.exe', ['/c', 'code', ...action.args], {
        windowsHide: true,
        stdio: 'ignore',
      })
      child.on('error', () => { void shell.openPath(action.path) })
      // `code` exits non-zero when it is not installed; the spawn itself succeeds
      // because cmd.exe ran, so the fallback has to hang off the exit code too.
      child.on('exit', code => { if (code !== 0) void shell.openPath(action.path) })
    } catch {
      void shell.openPath(action.path)
    }
    return true
  })

  const devUrl = devServerUrl()
  if (devUrl) await win.loadURL(devUrl)
  else await win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))

  // Start filling the spare pool, once the window's own two panes are past their
  // boot. Deferred, not immediate: claude's startup is dominated by remote MCP
  // connector handshakes, and one racing the launch would slow down the panes the
  // user is actually sitting in front of to make a tab they have not asked for
  // yet faster. The pool paces ITSELF from here (see PANE_GAP_MS/ROUND_GAP_MS) —
  // this call only decides when the first spare starts.
  //
  // sourceRoot because that is where App.tsx opens every new tab (DEFAULT_ROOT);
  // a spare at any other path would be rejected by takeWarm and wasted.
  pty().prewarm(ROOTS.sourceRoot, PREWARM_DELAY_MS)
})

app.on('window-all-closed', () => { app.quit() })

/**
 * How long to wait for the host to confirm every pty is dead before killing it
 * anyway. The timeout is the important half: a wedged host must not make bezel
 * unquittable, and killing the utility process takes its pwsh (and therefore
 * conpty) grandchildren with it. 500ms is far beyond the cost of killing two to
 * four ptys, so the ack is the normal path and this is the backstop.
 */
const SHUTDOWN_MS = 500

let shuttingDown = false
app.on('before-quit', e => {
  // Commit the remembered cwd before anything else. It is coalesced on a 1s
  // timer whose handle is unref'd, so without this the last directory of the
  // session — the one the next launch opens at — is the single value most
  // likely to be dropped.
  projectQueue?.flush()
  // killAll used to be synchronous, so quitting could not outrun it. Now it is a
  // message to another process, and an unmodified quit would exit before the ack
  // arrived — leaving orphaned pwsh.exe and conpty grandchildren behind. Defer
  // the quit exactly once, then let it through.
  if (shuttingDown || !ptyManager) return
  e.preventDefault()
  shuttingDown = true
  void ptyManager.shutdown(SHUTDOWN_MS).finally(() => app.quit())
})
