import type { PaneKey, AppEntry, GitInfo, SpecItem } from '@shared/types'
import type { SessionIntent } from '@shared/tabs'
import type { Roots } from '@shared/roots'
import type { LayoutPreset, RemotePresetRow } from '@shared/presets'
import type { UsageSnapshot } from '@shared/usage'
import type { ContextMeter } from '@shared/context-meter'
import type { ThemeBridge, FullscreenBridge, ThemeType } from '@devkit-inc/react-ui'

declare global {
  /** Injected by Vite from package.json — see `define` in vite.config.mts. */
  const __APP_VERSION__: string
  /** bezel's own `repository.url`, injected alongside the version. */
  const __APP_REPOSITORY__: string
  /** The @devkit-inc packages bezel is running, read out of node_modules at
   *  build time. RESOLVED versions, not the ranges in package.json. */
  const __INTERNAL_DEPS__: Array<{ name: string; version: string; repository?: string }>

  interface Window {
    bezel: {
      isElectron: boolean
      isDev: boolean
      minimize(): void
      maximize(): void
      close(): void
      // Exposed by exposeShellBridge since @devkit-inc/electron-ui 2.3.0; the
      // AppBar reads these to show Restore on an already-maximized window.
      isMaximized(): Promise<boolean>
      onMaximizeChange(cb: (maximized: boolean) => void): () => void
      pty: {
        spawn(key: PaneKey, cwd: string, intent: SessionIntent): Promise<string | null>
        /** Fire-and-forget: one-way IPC, with no reply to await. Typed `void`
         *  rather than `Promise<void>` so a call site that tries to sequence on
         *  it fails to typecheck instead of awaiting undefined. See preload.ts. */
        write(key: PaneKey, data: string): void
        resize(key: PaneKey, cols: number, rows: number): Promise<void>
        kill(key: PaneKey): Promise<void>
        onData(cb: (key: PaneKey, data: string) => void): () => void
        onExit(cb: (key: PaneKey, code: number) => void): () => void
      }
      apps: { list(refresh?: boolean): Promise<AppEntry[]> }
      git: { info(root: string): Promise<GitInfo | null> }
      /** Plan limits, from the account's own OAuth session. null = unavailable
       *  (no stored credential, offline, or the token needs a refresh). */
      usage: { get(): Promise<UsageSnapshot | null> }
      /** How full the Claude session that owns `cwd` is. null = no reading. */
      claudeContext: {
        /** `sessionId` names the tab's own conversation. Without it the reading
         *  falls back to the newest transcript under this cwd, which is a guess
         *  once more than one session shares a project directory. */
        meter(cwd: string, sessionId?: string): Promise<ContextMeter | null>
      }
      specs: {
        list(org: string, project: string): Promise<SpecItem[] | null>
        /** Opens the generated .html locally when present, else the .md on GitHub.
         *  Resolves to which one it used. */
        open(org: string, htmlPath: string): Promise<'local' | 'remote'>
      }
      project: {
        remember(cwd: string): Promise<void>
        /** Only called when the resolved repo root changes, not on every prompt. */
        rememberRepo(root: string): Promise<void>
        last(): Promise<{ cwd: string; repoRoot: string | null }>
        /** Checked per restored tab, before it spawns — see project:exists in
         *  main. Not used for the single remembered cwd, which `last` already
         *  falls back on its own. */
        exists(p: string): Promise<boolean>
        /** Whether a remembered claude session has a conversation on disk.
         *  An id alone proves nothing — claude writes the transcript only once
         *  the session has content, so a tab opened and never typed in has an
         *  id pointing at nothing. */
        sessionExists(sessionId: string, cwd: string): Promise<boolean>
      }
      clipboard: {
        write(text: string): Promise<void>
        read(): Promise<string>
      }
      layout: {
        /** The stored LayoutStore, unvalidated. parseStore repairs it. */
        load(): Promise<unknown>
        save(store: unknown): Promise<void>
      }
      tabs: {
        remember(set: unknown): Promise<void>
        last(): Promise<unknown>
      }
      /** Remote loading lines for the launch screen. Optional for the same
       *  reason `theme` and `panes` are: under jsdom no preload has run. */
      loading?: {
        /** Table shape (`message`); null when Supabase is unavailable. Only ever
         *  used to refresh the cache for the NEXT launch. */
        pull(): Promise<Array<{ message: string; weight: number }> | null>
      }
      presets: {
        /** Every row for this app, tombstones included; null when unavailable. */
        pull(): Promise<RemotePresetRow[] | null>
        push(presets: LayoutPreset[]): Promise<boolean>
        tombstone(id: string, now: string): Promise<boolean>
      }
      openExternal(url: string): Promise<void>
      /** Resolves false when the path is not on this box, so nothing was opened. */
      openFile(target: { path: string; line?: number; col?: number }): Promise<boolean>
      /**
       * Theme library + selection, from electron-ui's registerTheme. Optional
       * in both senses: it is optional on react-ui's own ShellBridge, and
       * useThemeRegistry falls back to the built-in themes when it is absent —
       * which is exactly what happens under jsdom, where no preload has run.
       * bezel now reads it directly (App owns the registry), so it has to be on
       * this type rather than only structurally satisfying AppBar's prop.
       */
      theme?: ThemeBridge
      /**
       * bezel's own channel to the PANES' prompt, distinct from `theme` above.
       * oh-my-posh renders in another process from the user's own config and
       * cannot see the registry's tokens, so the active type is handed to it as
       * an environment variable it re-reads each prompt (electron/pane-theme.ts).
       * Optional for the same reason `theme` is: under jsdom no preload has run.
       */
      panes?: { theme(theme: ThemeType): Promise<void> }
      /** True fullscreen, driven from the Appearance section. Optional for the
       *  same reason `theme` is. */
      fullscreen?: FullscreenBridge
      /** Derived once in the preload from os.homedir(); see src/roots.ts. A plain
       *  value, not a call, because it is read during render. */
      roots: Roots
    }
  }
}
export {}

