import { ipcRenderer } from 'electron'
import { homedir } from 'os'
import { exposeShellBridge, type BridgeMethods } from '@devkit-inc/electron-ui/preload'
// A relative import, not the `@shared` alias — see the note in specs-service.ts:
// tsc does not rewrite path-mapped specifiers on emit.
import { deriveRoots } from '../src/roots.js'

// BridgeMethods is typed as a flat function map, but exposeShellBridge just
// spreads `extra` into contextBridge.exposeInMainWorld (see the library's own
// nested `zoom` bridge) — a nested `pty` object is runtime-safe, so the cast
// below only papers over an upstream type that is narrower than what the
// function actually accepts.
exposeShellBridge('bezel', {
  pty: {
    spawn: (key: string, cwd: string, intent: unknown) => ipcRenderer.invoke('pty:spawn', key, cwd, intent),
    // `send`, not `invoke`, and alone among these in that. This fires once per
    // KEYSTROKE; `invoke` allocates a promise here and makes main send a reply
    // message back across the process boundary, and nothing reads either —
    // main's handler returns undefined and every call site discards it. The
    // reply was pure latency on the one path a user feels directly.
    // Returns void, which is what keeps that honest: a call site that tries to
    // await this now fails to typecheck rather than awaiting undefined.
    write: (key: string, data: string) => { ipcRenderer.send('pty:write', key, data) },
    resize: (key: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', key, cols, rows),
    kill: (key: string) => ipcRenderer.invoke('pty:kill', key),
    // Bare `ipcRenderer.on` has no disposer, so a mounting/unmounting
    // TerminalPane would otherwise leak a listener that closes over an
    // already-disposed xterm `Terminal` — the next frame would call
    // `.write()` on it. Return a function that removes exactly this
    // listener so the caller can clean up in its effect teardown.
    onData: (cb: (key: string, data: string) => void) => {
      const listener = (_e: unknown, key: string, data: string) => cb(key, data)
      ipcRenderer.on('pty:data', listener)
      return () => ipcRenderer.removeListener('pty:data', listener)
    },
    onExit: (cb: (key: string, code: number) => void) => {
      const listener = (_e: unknown, key: string, code: number) => cb(key, code)
      ipcRenderer.on('pty:exit', listener)
      return () => ipcRenderer.removeListener('pty:exit', listener)
    },
  },
  // Not part of the electron-ui `theme` bridge above it on purpose: that one is
  // the shared registry (list/getSelection/cachePaint), and this is bezel's own
  // side channel telling the panes' PROMPT which way to paint. Different
  // consumer, different process, different lifetime.
  panes: { theme: (theme: string) => ipcRenderer.invoke('panes:theme', theme) },
  apps: { list: (refresh = false) => ipcRenderer.invoke('apps:list', refresh) },
  git: { info: (root: string) => ipcRenderer.invoke('git:info', root) },
  // Claude Code's own state, read in main from ~/.claude. Deliberately two
  // channels rather than one "claude" bridge: the usage call is a network
  // request against an account-wide limit, the meter is a local file read
  // scoped to one directory, and they poll on very different clocks.
  usage: { get: () => ipcRenderer.invoke('usage:get') },
  claudeContext: { meter: (cwd: string, sessionId?: string) => ipcRenderer.invoke('context:meter', cwd, sessionId) },
  specs: {
    list: (org: string, project: string) => ipcRenderer.invoke('specs:list', org, project),
    open: (org: string, htmlPath: string) => ipcRenderer.invoke('specs:open', org, htmlPath),
  },
  project: {
    remember: (cwd: string) => ipcRenderer.invoke('project:remember', cwd),
    rememberRepo: (root: string) => ipcRenderer.invoke('project:rememberRepo', root),
    last: () => ipcRenderer.invoke('project:last'),
    exists: (p: string) => ipcRenderer.invoke('project:exists', p),
    /** Whether a remembered claude session has a conversation on disk. An id
     *  alone proves nothing: claude only writes the transcript once the session
     *  has content. */
    sessionExists: (sessionId: string, cwd: string) => ipcRenderer.invoke('session:exists', sessionId, cwd),
  },
  clipboard: {
    write: (text: string) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
  },
  layout: {
    load: () => ipcRenderer.invoke('layout:load'),
    save: (store: unknown) => ipcRenderer.invoke('layout:save', store),
  },
  tabs: {
    remember: (set: unknown) => ipcRenderer.invoke('tabs:remember', set),
    last: () => ipcRenderer.invoke('tabs:last'),
  },
  loading: { pull: () => ipcRenderer.invoke('loading:pull') },
  presets: {
    pull: () => ipcRenderer.invoke('presets:pull'),
    push: (presets: unknown[]) => ipcRenderer.invoke('presets:push', presets),
    tombstone: (id: string, now: string) => ipcRenderer.invoke('presets:tombstone', id, now),
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openFile: (target: { path: string; line?: number; col?: number }) =>
    ipcRenderer.invoke('shell:openFile', target),
  // A plain value, not an invoke: ContextProvider and TabStrip need the orgs root
  // DURING render. An async fetch would mean either a loading gate around
  // components that have none, or a first paint at the wrong root. Preload runs
  // before any renderer script, so this is populated by the time a module body
  // evaluates. Safe to expose — it is a path, derived from the OS, not a secret.
  // (`os` is reachable here because createShellWindow sets sandbox: false.)
  roots: deriveRoots(homedir()),
} as unknown as BridgeMethods)
