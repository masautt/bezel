import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { AppBar, useThemeRegistry } from '@devkit-inc/react-ui'
import { LayoutGlyph, AppearanceGlyph, InfoGlyph } from './icons'
import { TerminalPane } from './TerminalPane'
import { LoadingScreen } from './LoadingScreen'
import { Divider } from './Divider'
import { Gutter } from './Gutter'
import { TabStrip } from './TabStrip'
import { useTabShortcuts } from './useTabShortcuts'
import { takeLocalLayout } from './paneRatio'
import { SettingsModal, type SettingsSection } from './settings/SettingsModal'
import { LayoutSection } from './settings/sections/LayoutSection'
import { AppearanceSection } from './settings/sections/AppearanceSection'
import { AboutSection } from './settings/sections/AboutSection'
import { useSettingsShortcut } from './useSettingsShortcut'
import { useFullscreenShortcut } from './useFullscreenShortcut'
import {
  DEFAULT_STORE, parseStore, setLive, applyPreset, savePresetAs,
  saveToActive, renamePreset, deletePreset, resetLive, mergeRemotePresets,
  type LayoutStore,
} from '@shared/presets'
import { setHidden, moveSlot } from '@shared/layout'
import {
  resizeGutter, resetGutter, setPaneRatio, resizeSlot, resetSlot, toggleCollapse,
  toggleShellCollapsed,
  type GutterSide, type Layout, type WidgetId,
} from '@shared/layout'
import { ContextProvider } from './ContextProvider'
import { createTitleSettler, type TitleSettler } from '@shared/title-settler'
import { WidgetBoundary } from './WidgetBoundary'
import { ContextWidget } from './widgets/ContextWidget'
import { ChangesWidget } from './widgets/ChangesWidget'
import { SpecsWidget } from './widgets/SpecsWidget'
import { SessionWidget } from './widgets/SessionWidget'
import { WindowWidget } from './widgets/WindowWidget'
import { UsageWidget } from './widgets/UsageWidget'
import { parseOsc7 } from '@shared/osc7'
import {
  paneKey, createInitialTabs, createTab, closeTab, activateTab, activateNext,
  activatePrev, activateIndex, setTabCwd, setTabTitle, armClose, disarmAll,
  markAttention, clearAttention, parseTabs, toPersisted, recordSessionId,
  type TabsState, type PaneKey,
} from '@shared/tabs'
import { playChime } from './chime'
import type { AppEntry } from '@shared/types'
import { LOADING_CACHE_KEY, normalizeMessages } from '@shared/loading-messages'

/** The wordmark. Named once: it is both AppBar's `brand` and the label of the
 *  button bezel renders in its place. */
const BRAND = 'bezel'

/** Stable identity: an inline `() => {}` would be a new prop every render. */
const NO_DRAG = () => {}

// Holds the grid: one stacked layer per tab, plus the side gutters. Split out
// from App so it sits inside <ContextProvider> alongside the widgets that read
// it. The live OSC-7 -> context wiring lives in App: it calls setTabCwd on the
// tabs state, and App passes the active tab's cwd down as <ContextProvider cwd>,
// whose own effect re-syncs on every change — that is what retargets the
// gutters, both on a background tab's OSC 7 landing after it becomes active and
// on a plain tab switch. Since the repo switcher was removed, `cd` in the shell
// pane is the ONLY thing that moves a tab, and this is the whole path it takes.
function Bezel({ tabs, booted, missing, layout, onDrag, onGutter, onGutterReset, onSlotResize, onSlotToggle, onSlotReset, onOsc, onTitle, onBell, onPaneSpawned, onPaneData, onSessionId, onToggleShell }: {
  tabs: TabsState
  /** Tabs whose panes have actually been spawned — see the note on `booted` in App. */
  booted: ReadonlySet<number>
  /** Restored tabs whose cwd came back missing — see the note on `missing` in
   *  App. Never a member of `booted`; rendered as a placeholder instead of a
   *  pane pair so the tab's history stays reachable without spawning into a
   *  directory that is gone. */
  missing: ReadonlySet<number>
  layout: Layout
  onDrag: (deltaRatio: number) => void
  onGutter: (side: GutterSide, deltaPx: number) => void
  onGutterReset: (side: GutterSide) => void
  onSlotResize: (side: GutterSide, id: WidgetId, deltaRatio: number, seed: number) => void
  onSlotToggle: (side: GutterSide, id: WidgetId) => void
  onSlotReset: (side: GutterSide, id: WidgetId) => void
  /** Park the shell pane, or bring it back. Double-click on its divider. */
  onToggleShell: () => void
  onOsc: (tabId: number, payload: string) => void
  onTitle: (tabId: number, title: string) => void
  onBell: (tabId: number) => void
  /** Reports a pane whose initial spawn has answered — gates the launch screen. */
  onPaneSpawned: (key: PaneKey) => void
  /** Reports a pane's FIRST byte of output — also gates the launch screen. */
  onPaneData: (key: PaneKey) => void
  /** The claude pane's spawn ack reported (or confirmed) a session uuid — record it
   *  against the tab so the NEXT cold start of this tab resumes it. */
  onSessionId: (tabId: number, sessionId: string) => void
}) {
  // The gutters follow the active tab. Session history is per-tab state, so it
  // comes down as a prop rather than through ContextProvider, which is keyed to
  // the active directory.
  const activeHistory = tabs.tabs.find(t => t.id === tabs.activeId)?.history ?? []

  const ratio = layout.paneRatio

  // Built here rather than inside Gutter: SessionWidget needs the active tab's
  // history, which is not layout's business. Gutter only orders, sizes, and
  // collapses what it is given.
  const leftNodes = {
    context: <WidgetBoundary name="Context"><ContextWidget /></WidgetBoundary>,
    changes: <WidgetBoundary name="Changes"><ChangesWidget /></WidgetBoundary>,
  }
  // Each gauge is its own boundary, not a shared one: they read unrelated
  // sources (a local transcript, a network call) and a throw in either must not
  // blank the other.
  const rightNodes = {
    session: <WidgetBoundary name="Session"><SessionWidget history={activeHistory} /></WidgetBoundary>,
    specs: <WidgetBoundary name="Specs"><SpecsWidget /></WidgetBoundary>,
    window: <WidgetBoundary name="Window"><WindowWidget /></WidgetBoundary>,
    usage: <WidgetBoundary name="Usage"><UsageWidget /></WidgetBoundary>,
  }

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `${layout.gutters.left}px 4px minmax(0, 1fr) 4px ${layout.gutters.right}px` }}
    >
      <Gutter
        side="left"
        slots={layout.slots.left}
        nodes={leftNodes}
        onResize={(id, delta, seed) => onSlotResize('left', id, delta, seed)}
        onToggle={id => onSlotToggle('left', id)}
        onReset={id => onSlotReset('left', id)}
      />
      <Divider
        orientation="vertical"
        onDrag={(_ratio, px) => onGutter('left', px)}
        onReset={() => onGutterReset('left')}
      />
      {/* Every tab's panes stay MOUNTED — that is what keeps a background tab's
          pty alive and its scrollback intact. They are hidden with display:none
          (styles.css), which costs 90% less than the visibility:hidden this used
          to use: a hidden layer with a real box goes on rendering every chunk it
          receives, because rAF does not care that nothing is on screen.

          That was unsafe until `usableDimensions` (src/pane-size.ts) landed — a
          layer with no box measures 0x0, and that size used to be forwarded to
          the tab's background ptys. The guard is what makes hiding a pane a
          rendering decision rather than a correctness one. */}
      <main className="center">
        {tabs.tabs.map(tab => (
          <div
            key={tab.id}
            className={`layer${tab.id === tabs.activeId ? '' : ' hidden'}${layout.shellCollapsed ? ' layer-shell-collapsed' : ''}`}
            style={{
              gridTemplateRows: layout.shellCollapsed
                // A zero TRACK, not an unmount: the pane stays mounted so its
                // pty lives and its scrollback survives being put away — the
                // same reason inactive layers are hidden rather than unmounted
                // (see the note above). Safe for the same reason too: a pane on
                // a zero track measures nothing, and usableDimensions refuses
                // to pass that on.
                ? '1fr auto 0'
                : `${ratio}fr auto ${1 - ratio}fr`,
            }}
          >
            {booted.has(tab.id) ? (
              <>
                <TerminalPane
                  id={paneKey(tab.id, 'claude')}
                  cwd={tab.cwd}
                  intent={tab.claudeSessionId ? { mode: 'resume', id: tab.claudeSessionId } : { mode: 'new' }}
                  onSessionId={sessionId => onSessionId(tab.id, sessionId)}
                  onTitle={title => onTitle(tab.id, title)}
                  onBell={() => onBell(tab.id)}
                  onSpawned={() => onPaneSpawned(paneKey(tab.id, 'claude'))}
                  onFirstData={() => onPaneData(paneKey(tab.id, 'claude'))}
                />
                {/* While parked there is nothing to trade height with, so the
                    drag is disconnected and the bar is only a handle. */}
                <Divider
                  onDrag={layout.shellCollapsed ? NO_DRAG : onDrag}
                  onReset={onToggleShell}
                />
                <TerminalPane
                  id={paneKey(tab.id, 'shell')}
                  cwd={tab.cwd}
                  intent={{ mode: 'new' }}
                  onOsc={payload => onOsc(tab.id, payload)}
                  onBell={() => onBell(tab.id)}
                  onSpawned={() => onPaneSpawned(paneKey(tab.id, 'shell'))}
                  onFirstData={() => onPaneData(paneKey(tab.id, 'shell'))}
                />
              </>
            ) : missing.has(tab.id) ? (
              // Never spawned — see the guard in App's `activate`. The tab's
              // history is untouched (SessionWidget reads it independently of
              // `booted`), so this panel is the only visible sign anything is
              // different: an honest "gone", not a silent blank pane.
              <div className="tab-missing-panel">
                <p>This directory no longer exists.</p>
                <p className="tab-missing-path">{tab.cwd}</p>
              </div>
            ) : null}
          </div>
        ))}
      </main>
      <Divider
        orientation="vertical"
        onDrag={(_ratio, px) => onGutter('right', px)}
        onReset={() => onGutterReset('right')}
      />
      <Gutter
        side="right"
        slots={layout.slots.right}
        nodes={rightNodes}
        onResize={(id, delta, seed) => onSlotResize('right', id, delta, seed)}
        onToggle={id => onSlotToggle('right', id)}
        onReset={id => onSlotReset('right', id)}
      />
    </div>
  )
}

/**
 * How long an armed close stays armed before it forgets it was asked.
 *
 * This is a safety net against an arm left behind — NOT part of the
 * interaction, which is carried by the button reading "sure?". It has to be
 * comfortably longer than a user's read-and-decide pause: at 3s a second click
 * that came after any hesitation silently re-armed instead of closing, which is
 * what made the ✕ look dead.
 */
const DISARM_MS = 8000

/**
 * How long the launch screen stays up after both of the first tab's panes have
 * printed their first byte.
 *
 * Not a guess at how long spawning takes — that is what the spawn and first-data
 * signals measure. This covers the gap between "the ptys are alive" and "main is
 * answering IPC again", which is the interval the user experienced as a window
 * that had finished loading and ignored clicks anyway.
 */
const SETTLE_MS = 900

export function App() {
  // The launch/new-tab directory, from the preload (src/roots.ts). Read inside the
  // component, not at module scope — see the note in ContextProvider.
  const DEFAULT_ROOT = window.bezel.roots.sourceRoot
  // The whole layout state: `live` renders, `presets` sync. Seeded from
  // config.json in an effect rather than synchronously, because the store now
  // lives in main — so `loaded` gates the save effect below, which would
  // otherwise write DEFAULT_STORE over a real config before the read resolves.
  const [store, setStore] = useState<LayoutStore>(DEFAULT_STORE)
  const [loaded, setLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const layout = store.live
  const [apps, setApps] = useState<AppEntry[] | null | undefined>(undefined)
  // null = still resolving the remembered cwd. The whole shell (AppBar
  // included) waits on this rather than starting the terminals at a
  // hardcoded root and re-pointing them a tick later: `project:last` is a
  // single local JSON read over IPC (sub-millisecond), while re-pointing an
  // already-spawned pane means killing and respawning a pty — replaying that
  // cost on every launch would be slower than the brief wait up front.
  const [tabs, setTabs] = useState<TabsState | null>(null)
  // Restored tabs whose panes have actually been spawned. A restored tab is a
  // header and nothing more until you activate it: booting all of them would be
  // ~50s of connector init each, serialized, for tabs you may never open.
  const [booted, setBooted] = useState<Set<number>>(() => new Set())
  // Restored tabs whose cwd came back missing from project:exists, checked
  // once per tab at restore time, before anything spawns. A tab in here must
  // never enter `booted` — bezel now survives a spawn at a deleted directory
  // (the pty guard added earlier), but surviving a failure is not a reason to
  // walk into one. Deliberately NOT repointed at a fallback root: that would
  // misrepresent which workspace the tab was looking at, so the tab just says
  // the directory is gone and keeps its history.
  //
  // Not pruned when a tab closes — same as `booted` above, which has never
  // pruned closed ids either. Harmless: ids are never reused (`nextId` only
  // grows), so a stale id sitting in either set can never collide with a
  // later tab. Noted because this is a NEW state bag, not because it needs
  // fixing to match `booted`'s existing behavior.
  const [missing, setMissing] = useState<Set<number>>(() => new Set())
  // Pane keys whose initial spawn round-trip has come back. Only the FIRST
  // tab's two panes gate the launch screen — every later tab adopts a prewarmed
  // spare and is effectively instant, so covering them would put a full-window
  // overlay over a window the user is already working in.
  const [spawnedPanes, setSpawnedPanes] = useState<ReadonlySet<PaneKey>>(() => new Set())
  const onPaneSpawned = useCallback((key: PaneKey) => {
    setSpawnedPanes(prev => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])
  // Panes that have produced OUTPUT, which is a different and much later event
  // than the one above. `pty.spawn` resolving only means main handed back a
  // process handle; the shell has not run its profile, oh-my-posh has not drawn a
  // prompt, and claude has not painted its banner. Dismissing on spawn alone is
  // what left a window that looked finished and swallowed the next ~2s of clicks
  // — the reported bug. First byte is the earliest moment there is something in
  // the pane to click on.
  const [livePanes, setLivePanes] = useState<ReadonlySet<PaneKey>>(() => new Set())
  const onPaneData = useCallback((key: PaneKey) => {
    setLivePanes(prev => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])
  // A spawn that never answers must not strand the user behind an overlay
  // forever: past this point the shell is shown regardless, dead panes and all,
  // because an unusable window you can see beats one you cannot reach. Generous
  // on purpose — the measured worst case is ~14s.
  // Refresh the launch screen's text — for the NEXT launch, never this one.
  // Fires only once both panes have answered, because an invoke sent while main
  // is inside a synchronous nodePty.spawn queues behind it: asking sooner would
  // not arrive sooner, it would just sit in the queue holding a promise open.
  const refreshedRef = useRef(false)
  useEffect(() => {
    if (refreshedRef.current || spawnedPanes.size < 2) return
    refreshedRef.current = true
    void window.bezel.loading?.pull().then(rows => {
      const fresh = normalizeMessages(rows)
      // An empty result means the table is empty or unreachable. Keeping the
      // previous cache is strictly better than replacing it with nothing.
      if (fresh.length === 0) return
      try {
        window.localStorage.setItem(LOADING_CACHE_KEY, JSON.stringify(fresh))
      } catch {
        // Storage full or unavailable. The built-ins still work; a cache that
        // cannot be written is not worth a word to the user.
      }
    }).catch(() => {
      // Best-effort by design — see loading-messages-service.ts.
    })
  }, [spawnedPanes])

  const [launchTimedOut, setLaunchTimedOut] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLaunchTimedOut(true), 45000)
    return () => clearTimeout(timer)
  }, [])

  // Both of the BOOTING tab's panes have spawned AND both have printed
  // something. Only that one tab gates the screen: every later tab adopts a
  // prewarmed spare and is effectively instant, so covering them would put a
  // full-window overlay over a window the user is already working in.
  //
  // That tab is the ACTIVE one, and nothing else — restore boots exactly
  // `restored.activeId` (see the effect below) and leaves every other tab
  // dormant. Gating on "the first tab that isn't missing" instead looks
  // right but names a tab that never spawns whenever the remembered active
  // tab is not the leftmost one: its panes never mount, `spawnedPanes` never
  // gains its keys, and the launch overlay covers a window whose active tab
  // is already working for the full 45s `launchTimedOut` fallback. A missing
  // active tab does not boot either, hence the `missing` guard — and then
  // there is no booting tab at all, which `nothingBoots` below handles.
  const firstTabId = tabs && !missing.has(tabs.activeId) ? tabs.activeId : undefined
  // No tab will boot AT ALL — the active tab's directory is gone, so `booted`
  // is initialized empty and no other tab boots on restore either. There are
  // no panes to wait for, so waiting means sitting under the overlay for the
  // full 45s fallback over a strip the user could already be using. This
  // subsumes the every-tab-missing case rather than sitting beside it: that
  // one is just this one where the active tab is also the only tab.
  //
  // `tabs !== null` is load-bearing and is NOT the same as `firstTabId ===
  // undefined` alone: while tabs are still loading there is no booting tab
  // either, and `panesLive` must stay false the normal way. (The pre-tabs
  // branch never reaches `launchReady`, but `settled`'s effect below runs on
  // every render regardless, so a stuck `true` here would carry over once
  // tabs actually arrive.)
  const nothingBoots = tabs !== null && firstTabId === undefined
  const panesLive =
    nothingBoots ||
    (firstTabId !== undefined &&
      spawnedPanes.has(paneKey(firstTabId, 'claude')) &&
      spawnedPanes.has(paneKey(firstTabId, 'shell')) &&
      livePanes.has(paneKey(firstTabId, 'claude')) &&
      livePanes.has(paneKey(firstTabId, 'shell')))

  // …and then one more beat. First byte means the pty is talking, not that the
  // window is responsive: main is still finishing the second spawn's synchronous
  // tail and answering the queue of IPC calls that piled up behind it (the apps
  // scan, git status, the layout read), and a click landing in that window still
  // goes nowhere. SETTLE_MS is the cost of being wrong in the safe direction —
  // a fraction of a second more of a screen that is honestly saying "starting",
  // versus a window that lies about being ready.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!panesLive) return
    const timer = setTimeout(() => setSettled(true), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [panesLive])

  // A rejected (or never-resolving) call must not leave the window
  // permanently blank — main's `readUserConfig` is try/catch-wrapped so this
  // is a low-probability path today, but the renderer has no way to know
  // that, and `app.getPath('userData')` can still throw under unusual
  // profile-permission setups. Fail safe to the default root.
  // Gate on the RESTORE having settled successfully, not merely on `tabs`
  // being non-null. The persist effect below fires on the first non-null
  // `tabs`, so without this a single rejected `tabs:last` — or a truncated
  // write that leaves a `tabs` key parseTabs cannot use — put the fallback
  // single fresh tab on main's 1s queue and destroyed every remembered tab's
  // cwd, history and session id within about a second, with no copy left.
  //
  // "Settled successfully" is either of two things: a set that restored, or a
  // config with no `tabs` key at all (the genuine first launch, where there is
  // nothing to protect). A PRESENT but unusable key is the case that must not
  // write: it is indistinguishable from a truncated one, and the stored bytes
  // are the only copy. The cost of failing closed is that this session's tab
  // changes are not remembered — recoverable by relaunching; the cost of
  // failing open is the set itself, which is not.
  const [persistable, setPersistable] = useState(false)
  useEffect(() => {
    void window.bezel.tabs.last()
      .then(raw => {
        const parsed = parseTabs(raw)
        if (parsed) {
          // Rebindable, unlike `parsed`: a tab whose transcript turns out to be
          // missing has its session id stripped below, before anything is
          // rendered or written.
          let restored: TabsState = parsed
          setPersistable(true)
          // Checked per tab, before anything boots: a restored tab whose
          // directory was renamed or deleted since the last launch must not
          // spawn into it. `project:last` already does the equivalent check
          // for the single remembered cwd; this is the same idea applied to
          // every tab in the set.
          //
          // Each check's rejection is caught INSIDE the map, not left to
          // bubble to the outer `.catch` below — that one discards the whole
          // restored session and falls back to a single fresh tab, which
          // would turn one flaky IPC round-trip for one tab's cwd into a lost
          // session and history for every OTHER tab too. A failed check marks
          // only its own tab missing (fail closed, matching "don't spawn into
          // a directory you couldn't confirm exists"); the rest of the
          // restored set survives untouched.
          return Promise.all(restored.tabs.map(t => Promise.all([
            window.bezel.project.exists(t.cwd).catch(() => false),
            // A remembered id is not proof of a conversation. bezel assigns the
            // id at spawn, but claude writes the transcript only once the
            // session has content — so a tab you opened and never typed in
            // carries an id that resolves to nothing, and resuming it printed
            // "No conversation found with session ID" into the pane. The
            // failed-resume heuristic could not catch that: claude PRINTS the
            // error rather than exiting silently, so the no-bytes half of the
            // rule was false. Checking the file is deterministic where the
            // timing rule is a guess. Fail closed on a rejected check — a fresh
            // session costs a conversation that may exist; a bad resume costs a
            // pane that does not work at all.
            t.claudeSessionId
              ? window.bezel.project.sessionExists(t.claudeSessionId, t.cwd).catch(() => false)
              : Promise.resolve(false),
          ])))
            .then(checks => {
              const exists = checks.map(c => c[0])
              const missingIds = new Set(
                restored.tabs.filter((_t, i) => !exists[i]).map(t => t.id),
              )
              // Drop the id of any tab whose transcript is gone, so it spawns
              // `{ mode: 'new' }` with a fresh, recordable uuid instead of
              // resuming a ghost. Reference-stable when nothing was dropped, so
              // this cannot cause a needless re-render or a spurious write.
              const ghosts = restored.tabs.filter((t, i) => t.claudeSessionId && !checks[i][1])
              if (ghosts.length > 0) {
                const ghostIds = new Set(ghosts.map(t => t.id))
                restored = {
                  ...restored,
                  tabs: restored.tabs.map(t => {
                    if (!ghostIds.has(t.id)) return t
                    // Rebuilt without the key rather than set to undefined:
                    // toPersisted only writes claudeSessionId when it is
                    // truthy, and an absent key is what "this tab has no
                    // session yet" means everywhere else.
                    const rest = { ...t }
                    delete rest.claudeSessionId
                    return rest
                  }),
                }
              }
              setTabs(restored)
              setMissing(missingIds)
              setBooted(missingIds.has(restored.activeId) ? new Set() : new Set([restored.activeId]))
            })
        }
        // Nothing usable remembered — the first-launch path, unchanged. Only
        // the cwd half is used here; ContextProvider consumes `repoRoot`.
        // `raw == null` is "no tabs key was ever written"; anything else here
        // is a key that FAILED to parse, and overwriting that would discard
        // the only copy of a set that may just have been truncated.
        if (raw == null) setPersistable(true)
        return window.bezel.project.last().then(({ cwd }) => {
          const fresh = createInitialTabs(cwd)
          setTabs(fresh)
          setBooted(new Set([fresh.activeId]))
        })
      })
      .catch(() => {
        const fresh = createInitialTabs(DEFAULT_ROOT)
        setTabs(fresh)
        setBooted(new Set([fresh.activeId]))
      })
    // DEFAULT_ROOT comes from the preload and is constant for the process, so
    // listing it satisfies the exhaustive-deps rule without ever re-running this.
  }, [DEFAULT_ROOT])
  // Three states, not two, because `[]` cannot be disambiguated after the fact:
  // `undefined` = not resolved yet, `null` = the scan failed, `[]` = there really
  // are no repos. This previously collapsed a rejection into `[]`, which
  // the switcher renders as "scanning…" — so a permanent failure showed a progress
  // message forever and the user waited on it. Same shape `specsViewState`
  // already uses, for the same reason.
  //
  // A failure still cascades the way it always did: repoRoots becomes [], so
  // resolveProjectPath's injected isRepo always returns false and the gutter
  // widgets go dark. What changes is that the switcher now says so.
  // Shared by the mount effect and the switcher's retry, so both go through
  // the same three-state contract. `refresh` bypasses main's session cache —
  // without it a retry after a failed scan would return the same cached miss.
  const loadApps = useCallback((refresh = false) => {
    setApps(undefined)
    void window.bezel.apps.list(refresh).then(setApps).catch(() => setApps(null))
  }, [])
  useEffect(() => { loadApps() }, [loadApps])
  const repoRoots = useMemo(() => (apps ?? []).map(a => a.root), [apps])

  // Readable from callbacks without re-creating them on every layout change,
  // and — more importantly — lets the preset handlers compute their next state
  // OUTSIDE a setState updater, which must stay pure.
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    void window.bezel.layout.load()
      .then(raw => {
        if (raw != null) { setStore(parseStore(raw)); return }
        // First run after the move to config.json: keep whatever the user had
        // dragged rather than silently resetting them to the defaults.
        const migrated = takeLocalLayout(localStorage)
        if (migrated) setStore(prev => ({ ...prev, live: migrated }))
      })
      // A failed read leaves DEFAULT_STORE, which is a working app.
      .catch(() => { /* ignore */ })
      .finally(() => setLoaded(true))
  }, [])

  // Debounced in an EFFECT, not inside the state updater: a drag emits a layout
  // per pointermove, and an updater that writes is impure — React may call it
  // more than once per commit, doubling the IPC.
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => { void window.bezel.layout.save(store) }, 400)
    return () => clearTimeout(timer)
  }, [store, loaded])

  // Preset sync, once, after the local store has already rendered. Best-effort
  // in both directions: a null pull means unavailable, and the app carries on
  // against config.json exactly as the Specs widget does.
  useEffect(() => {
    if (!loaded) return
    void window.bezel.presets.pull()
      .then(rows => {
        if (!rows) return
        const { store: merged, push } = mergeRemotePresets(storeRef.current, rows)
        setStore(merged)
        if (push.length > 0) void window.bezel.presets.push(push)
      })
      .catch(() => { /* offline or no credentials — local wins */ })
  }, [loaded])

  // One funnel for every LIVE layout change. The reducers return the SAME object
  // when a drag is already clamped or an id is not in that gutter, so a no-op
  // drag neither re-renders the tree nor schedules a write.
  const update = useCallback((fn: (prev: Layout) => Layout) => {
    setStore(prev => setLive(prev, fn(prev.live)))
  }, [])

  /** Preset mutations: computed against the ref so nothing impure runs in an
   *  updater, and synced immediately since these are rare, deliberate acts. */
  const mutate = useCallback((fn: (prev: LayoutStore, now: string) => LayoutStore) => {
    const now = new Date().toISOString()
    const prev = storeRef.current
    const next = fn(prev, now)
    if (next === prev) return
    setStore(next)
    // Push only what actually changed identity or content.
    const changed = next.presets.filter(p => {
      const before = prev.presets.find(q => q.id === p.id)
      return !before || before.updatedAt !== p.updatedAt
    })
    if (changed.length > 0) void window.bezel.presets.push(changed)
  }, [])

  const onDrag = useCallback((deltaRatio: number) => {
    update(prev => setPaneRatio(prev, prev.paneRatio + deltaRatio))
  }, [update])

  const onGutter = useCallback((side: GutterSide, deltaPx: number) => {
    update(prev => resizeGutter(prev, side, deltaPx))
  }, [update])

  const onGutterReset = useCallback((side: GutterSide) => {
    update(prev => resetGutter(prev, side))
  }, [update])

  const onToggleShell = useCallback(() => {
    update(prev => toggleShellCollapsed(prev))
  }, [update])

  const onSlotResize = useCallback((side: GutterSide, id: WidgetId, deltaRatio: number, seed: number) => {
    update(prev => resizeSlot(prev, side, id, deltaRatio, seed))
  }, [update])

  const onSlotToggle = useCallback((side: GutterSide, id: WidgetId) => {
    update(prev => toggleCollapse(prev, side, id))
  }, [update])

  const onSlotReset = useCallback((side: GutterSide, id: WidgetId) => {
    update(prev => resetSlot(prev, side, id))
  }, [update])

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  useSettingsShortcut(openSettings)

  // Optional-chained rather than gated: on a shell with no `fullscreen` bridge
  // the key is still claimed and simply does nothing, which is better than
  // letting a bare F11 through to the pty as `ESC[23~` on that one build.
  useFullscreenShortcut(useCallback(() => window.bezel.fullscreen?.toggle(), []))

  // The theme registry is owned HERE rather than inside the AppBar (its default)
  // or inside AppearanceSection, because it is the thing that paints the app and
  // both of those are conditional:
  //   - AppBar's own copy is driven by the ⋯ menu, which bezel no longer renders
  //     (`menu={false}`) — the picker lives in settings now.
  //   - AppearanceSection is built by `SettingsSection.render`, which runs only
  //     while that section is the visible one. A registry created there would
  //     exist only while the dialog is open.
  // App is the only place that is always mounted, so this is the only place the
  // hook can live. `manageTheme={false}` below stops the AppBar from starting a
  // SECOND registry against the same bridge: two of them would each pull the
  // remote library and each adopt the cross-machine selection, and whichever
  // resolved last would win — a theme picked here could be yanked back a moment
  // later by the other one's startup.
  const themeRegistry = useThemeRegistry(window.bezel.theme)

  // The panes' prompt is drawn by oh-my-posh, in the pty, from the user's own
  // config — it cannot see the tokens the registry just wrote to <html>, so it
  // is told separately. Only the TYPE goes down: the prompt has two palettes,
  // not one per theme in the library, so sending the id would rewrite the file
  // on every switch for no change downstream.
  //
  // Optional-chained because under jsdom no preload has run (same reason
  // `theme` and `fullscreen` are optional on the bridge), and fire-and-forget
  // because nothing here depends on the write landing — the shell reads the
  // file on its next prompt, whenever that is.
  const paneThemeType = themeRegistry.theme.type
  useEffect(() => {
    void window.bezel.panes?.theme(paneThemeType)
  }, [paneThemeType])

  // Built here because every one of these needs `mutate`/`update`, which own the
  // persistence and sync. The section itself stays presentational.
  const sections = useMemo<SettingsSection[]>(() => [
    {
      id: 'layout',
      label: 'Layout',
      icon: <LayoutGlyph />,
      render: () => (
        <LayoutSection
          store={store}
          onApply={id => mutate(prev => applyPreset(prev, id))}
          onSaveAs={name => mutate((prev, now) => savePresetAs(prev, name, crypto.randomUUID(), now))}
          onSaveToActive={() => mutate((prev, now) => saveToActive(prev, now))}
          onRename={(id, name) => mutate((prev, now) => renamePreset(prev, id, name, now))}
          onDelete={id => {
            // Tombstone rather than a plain delete: a hard delete lets any
            // machine that still holds it push it back on its next startup.
            void window.bezel.presets.tombstone(id, new Date().toISOString())
            mutate(prev => deletePreset(prev, id))
          }}
          onToggleHidden={(side, id, hidden) => update(prev => setHidden(prev, side, id, hidden))}
          onMove={(side, id, delta) => update(prev => moveSlot(prev, side, id, delta))}
          onResetLive={() => mutate(prev => resetLive(prev))}
        />
      ),
    },
    {
      id: 'appearance',
      label: 'Appearance',
      icon: <AppearanceGlyph />,
      render: () => <AppearanceSection registry={themeRegistry} />,
    },
    {
      id: 'about',
      label: 'About',
      icon: <InfoGlyph />,
      render: () => <AboutSection version={__APP_VERSION__} />,
    },
  ], [store, mutate, update, themeRegistry])

  // Which tab is active, readable from callbacks without re-creating them on
  // every switch. State updaters must stay pure, so the "only the active tab
  // persists its cwd" check reads this rather than the state under update.
  const activeIdRef = useRef(0)
  activeIdRef.current = tabs?.activeId ?? 0

  // Readable from `activate`/`onCloseIntent` without making either depend on
  // `missing` and re-creating on every restore-time update — same reasoning
  // as `activeIdRef` above.
  const missingRef = useRef<Set<number>>(new Set())
  missingRef.current = missing

  const disarmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelDisarm = useCallback(() => clearTimeout(disarmTimer.current), [])
  useEffect(() => cancelDisarm, [cancelDisarm])

  // A tab's shell pane reports OSC 7 on every prompt. Background tabs update
  // their OWN cwd (so their label and context are right the moment you switch
  // to them), but only the ACTIVE tab writes the remembered launch directory —
  // otherwise a background shell would silently rewrite where the next cold
  // launch starts. Fire-and-forget: losing a single write to disk contention
  // just means the next launch falls back one step further, never a crash.
  const onOsc = useCallback((tabId: number, payload: string) => {
    const next = parseOsc7(payload)
    if (!next) return
    setTabs(s => (s ? setTabCwd(s, tabId, next) : s))
    if (tabId === activeIdRef.current) void window.bezel.project.remember(next)
  }, [])

  // Terminal titles do NOT go straight to the reducer: they are debounced
  // through the settler first, so a tab is named after what its session is
  // doing rather than after the command that happens to be running this
  // second. See src/title-settler.ts for why the filter is time and not a
  // list of command names.
  //
  // Built once and kept in a ref rather than state — it owns timers, and a
  // rebuild would strand them. The commit goes through setTabTitle unchanged;
  // the reducer's contract is the same, it is simply called far less often.
  const settler = useRef<TitleSettler | null>(null)
  settler.current ??= createTitleSettler((tabId, title) => {
    setTabs(s => (s ? setTabTitle(s, tabId, title) : s))
  })
  // Cancels the timers, and deliberately does NOT null the ref: the settler is
  // built during render, so clearing it here would leave a window with no
  // settler at all until the next render — which under StrictMode's
  // mount/unmount/mount is a window the app actually passes through.
  useEffect(() => () => settler.current?.dispose(), [])

  const onTitle = useCallback((tabId: number, title: string) => {
    settler.current?.propose(tabId, title)
  }, [])

  // The claude pane's spawn ack, whether it minted a fresh uuid or confirmed
  // the one asked for on a `--resume`. Recorded so the NEXT cold start of this
  // tab resumes instead of starting over.
  const onSessionId = useCallback((tabId: number, sessionId: string) => {
    setTabs(s => (s ? recordSessionId(s, tabId, sessionId) : s))
  }, [])

  // Whether the window has the user's eyes. Seeded from document.hasFocus()
  // rather than assuming true: a window can be launched into the background
  // (start-with-Windows, or a shortcut clicked and then alt-tabbed away from),
  // and a wrong seed would swallow the first bell of the session.
  const focusedRef = useRef(true)
  useEffect(() => {
    focusedRef.current = document.hasFocus()
    const onFocus = () => {
      focusedRef.current = true
      // Coming back to the window answers the bell of the tab already in
      // front of you — but ONLY that one. A background tab that rang keeps its
      // mark until you actually switch to it, which is the whole point of it.
      setTabs(s => (s ? clearAttention(s, s.activeId) : s))
    }
    const onBlur = () => { focusedRef.current = false }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur) }
  }, [])

  /**
   * A pane rang the bell.
   *
   * Ignored outright when you are already watching that tab in a focused
   * window: marking the pane you are looking at is noise, and it would be
   * instantly cleared anyway. Everything else — a background tab, or the
   * active tab while bezel is behind another window — is real news.
   *
   * The gate is evaluated OUT here against refs, not inside the updater:
   * updaters must stay pure and React may run one more than once, which would
   * double the chime.
   */
  const onBell = useCallback((tabId: number) => {
    if (tabId === activeIdRef.current && focusedRef.current) return
    playChime()
    setTabs(s => (s ? markAttention(s, tabId) : s))
  }, [])

  // Marks a tab as booted (its panes may mount and spawn ptys) alongside
  // activating it. Every path that can bring a tab to the front — a click, a
  // shortcut, a brand-new tab — must route through this so a restored tab
  // that was never activated stays a header-only placeholder.
  const activate = useCallback((id: number) => {
    setTabs(s => (s ? activateTab(s, id) : s))
    // A tab in `missing` never boots — see the note on `missing` above. It
    // still becomes active so its label, history and the "directory is gone"
    // panel are reachable; it just never gets a pane pair.
    if (missingRef.current.has(id)) return
    setBooted(b => (b.has(id) ? b : new Set(b).add(id)))
  }, [])

  // Reads `tabs` directly rather than through a setState updater, matching
  // onCloseIntent below: createTab's new id is decided from the CURRENT
  // state, and the resulting id has to be known out here to boot it —
  // an updater must stay pure, so it cannot also call setBooted.
  const onNew = useCallback(() => {
    cancelDisarm()
    if (!tabs) return
    const next = createTab(tabs, DEFAULT_ROOT)
    setTabs(next)
    setBooted(b => (b.has(next.activeId) ? b : new Set(b).add(next.activeId)))
  }, [cancelDisarm, DEFAULT_ROOT, tabs])

  const onSelect = useCallback((id: number) => {
    cancelDisarm()
    activate(id)
  }, [cancelDisarm, activate])

  // First click arms, second closes. Closing kills both of the tab's ptys —
  // the renderer unmounting the panes disposes the xterms, but nothing else
  // would ever kill the processes.
  //
  // The branch is decided BEFORE calling setTabs, from the `tabs` state
  // already in scope, and every side effect (the disarm timer, the two pty
  // kills) happens out here too. Updaters must stay pure — React may invoke
  // one more than once — so scheduling a timer or firing an IPC call from
  // inside it would double up: two timers (only the second clearable, so the
  // orphan disarms whatever tab is armed ~3s later) or two kill calls.
  const onCloseIntent = useCallback((id: number) => {
    cancelDisarm()
    if (!tabs) return
    const tab = tabs.tabs.find(t => t.id === id)
    if (!tab) return
    if (!tab.closeArmed) {
      disarmTimer.current = setTimeout(() => setTabs(cur => (cur ? disarmAll(cur) : cur)), DISARM_MS)
      setTabs(s => (s ? armClose(s, id) : s))
      return
    }
    void window.bezel.pty.kill(paneKey(id, 'claude'))
    void window.bezel.pty.kill(paneKey(id, 'shell'))
    // Out here with the kills, and for the same reason: a side effect must not
    // live in an updater. Without this, a title still on the clock would land
    // after the tab is gone — and ids are handed out by a counter that a
    // restored set can rewind, so "gone" is not the same as "unreachable".
    settler.current?.forget(id)
    if (tabs.tabs.length <= 1) {
      // Closing the last tab is a quit (Windows-Terminal-style), not a
      // reducer transition — closeTab refuses to empty the list, and the app
      // must never render a zero-tab state. The ptys above are killed
      // up front for symmetry with the normal path; before-quit in
      // electron/main.ts also calls killAll(), and killing an
      // already-removed key there is a safe no-op.
      window.bezel.close()
      return
    }
    // Read outside the updater, matching onNew: closeTab can land activeId on
    // a geometric neighbor (index+1, else index-1) that was never activated —
    // a restored tab nobody has clicked yet — and that id has to be known out
    // here to boot it. Without this, closing the active tab could hand focus
    // to a tab whose panes stay gated out forever.
    const next = closeTab(tabs, id)
    setTabs(next)
    // Same guard as `activate`: the geometric neighbor closeTab lands on
    // could be a tab whose directory is missing, and that must not boot it.
    if (!missingRef.current.has(next.activeId)) {
      setBooted(b => (b.has(next.activeId) ? b : new Set(b).add(next.activeId)))
    }
  }, [cancelDisarm, tabs])

  // Rides main's 1s coalescing queue, so this fires freely: a burst of tab
  // changes is one write, and before-quit flushes whatever is pending.
  useEffect(() => {
    if (!tabs || !persistable) return
    void window.bezel.tabs.remember(toPersisted(tabs))
  }, [tabs, persistable])

  useTabShortcuts({
    onNew,
    onCloseIntent: () => onCloseIntent(activeIdRef.current),
    // The pure reducers decide WHICH tab becomes active from the current
    // `tabs` snapshot; `activate` then applies that same transition and
    // marks the result booted. Reading `tabs` here (not via a setState
    // updater) is what makes the target id available to pass to `activate`.
    onNext: () => { cancelDisarm(); if (tabs) activate(activateNext(tabs).activeId) },
    onPrev: () => { cancelDisarm(); if (tabs) activate(activatePrev(tabs).activeId) },
    onIndex: index => { cancelDisarm(); if (tabs) activate(activateIndex(tabs, index).activeId) },
  })

  // The remembered-cwd read has not answered yet. Showing the launch screen here
  // rather than nothing means the very first paint is already the loading state,
  // instead of a blank window that becomes one a tick later.
  // Wrapped in the SAME .app root, with the screen in the SAME first-child slot
  // as the branch below. React then reconciles it as one element across the
  // transition instead of unmounting and remounting it — without this the
  // message picked at first paint is thrown away ~60ms later and the fade
  // replays, which reads as a flicker.
  /* The brand IS the settings button. It sits where AppBar's own brand would
     have, so the bar looks unchanged until you hover it — and it is
     corner-flush (styles.css zeroes the bar's left padding and moves the inset
     onto this button), so the whole top-left corner is the target on a
     maximized window. `no-drag` there too: the bar is one big drag region and
     react-ui exempts only its own buttons. Ctrl+, opens the same dialog.

     Hoisted out of `actions` because BOTH branches render it — during launch it
     is the only action, since the tab strip has nothing worth showing yet. */
  const brandButton = (
    <button
      type="button"
      className="appbar-brand"
      title="Settings (Ctrl+,)"
      // The visible text is the accessible name's first word, so speech input
      // ("click bezel") still works — but "bezel, button" alone says nothing
      // about what it does, hence the second half.
      aria-label={`${BRAND} settings`}
      onClick={openSettings}
    >
      {/* Reproduces AppBar's own dev suffix; without it the marker would vanish
          from every dev window along with the span it came from. */}
      {window.bezel.isDev ? `${BRAND} (dev)` : BRAND}
    </button>
  )

  if (!tabs) {
    return (
      <div className="app">
        <LoadingScreen detail="starting your terminals" />
        {/* Minimize/maximize/close, available from the very first frame.
            Without a bar here the launch screen was a window you could drag
            (.loading-screen is a drag region) but could not close, minimize or
            maximize for the whole startup — which is exactly when you most want
            to, since it is also when the app is least responsive.

            Deliberately AFTER the screen, matching the order in the branch
            below: the screen stays the first child, so React reconciles it as
            one element across the transition and the fade does not replay. The
            bar reconciles the same way, in slot two, and simply gains its
            actions once there are tabs to put in them. */}
        <AppBar
          bridge={window.bezel}
          brand={BRAND}
          nav={false}
          menu={false}
          manageTheme={false}
          actions={brandButton}
        />
        {/* Rendered here too, or the brand above would be a button that sets
            state and shows nothing: the modal lives in the other branch. */}
        <SettingsModal open={settingsOpen} sections={sections} onClose={() => setSettingsOpen(false)} />
      </div>
    )
  }

  const launchReady = launchTimedOut || settled

  const activeTab = tabs.tabs.find(t => t.id === tabs.activeId)
  const activeCwd = activeTab?.cwd ?? DEFAULT_ROOT

  return (
    // `launching` is what hides the tab strip while the launch screen is up.
    // A class on the root rather than a prop threaded into TabStrip: nothing
    // about the strip itself changes, only whether this app is still starting,
    // and the same flag is the natural hook for anything else that should sit
    // out the launch.
    <div className={launchReady ? 'app' : 'app launching'}>
      {/* Rendered as a sibling overlay rather than instead of the shell: the
          panes must MOUNT and spawn their ptys underneath it, since their spawn
          round-trip is what brings it down. */}
      {launchReady ? null : <LoadingScreen detail="starting your terminals" />}
      <AppBar
        bridge={window.bezel}
        // Still passed, and still the source of the name below — but the span
        // AppBar renders from it is hidden in styles.css, because a wordmark you
        // can click has to be a <button> and AppBar's is a <span> inside the drag
        // region. bezel renders its own in the actions slot instead.
        brand={BRAND}
        nav={false}
        // No ⋯ menu. It held exactly three things — Settings…, Theme and Full
        // screen — and all three moved: Settings is the wordmark below, and the
        // other two are rows in the Appearance section. A one-item overflow menu
        // beside a brand that opens the same settings is clutter, and the theme
        // picker specifically should not be reachable from the title bar.
        menu={false}
        // The registry above is bezel's; without this the AppBar starts a second
        // one against the same bridge. See the note there.
        manageTheme={false}
        actions={
          <>
            {brandButton}
            {/* Hidden, not unmounted, while the launch screen is up — see the
                `launching` class on the root below. The strip is real and
                clickable the moment it paints, but every one of its targets —
                switch, close, new tab — needs main, which is blocked inside
                nodePty.spawn for the whole launch. A tab and a ＋ that do
                nothing when clicked are worse than none, and they clutter a
                screen whose only job is to say "starting".
                Kept mounted because unmounting it would remount it on every
                launch for no gain, and because the panes underneath must not
                be disturbed by anything this bar does. */}
            <TabStrip
              tabs={tabs.tabs}
              activeId={tabs.activeId}
              repoRoots={repoRoots}
              booted={booted}
              missing={missing}
              onSelect={onSelect}
              onCloseIntent={onCloseIntent}
              onNew={onNew}
            />
          </>
        }
      />
      {/* The gutters follow the ACTIVE tab: one provider, never remounted —
          remounting it would tear down every layer (and every pty) beneath
          it. Its `cwd` prop tracks the active tab and its own effect re-syncs
          on every change, which is what retargets the gutters on a switch. */}
      <ContextProvider cwd={activeCwd} activeId={tabs.activeId} sessionId={activeTab?.claudeSessionId} repoRoots={repoRoots}>
        <Bezel
          tabs={tabs}
          booted={booted}
          missing={missing}
          layout={layout}
          onDrag={onDrag}
          onGutter={onGutter}
          onGutterReset={onGutterReset}
          onSlotResize={onSlotResize}
          onSlotToggle={onSlotToggle}
          onSlotReset={onSlotReset}
          onToggleShell={onToggleShell}
          onOsc={onOsc}
          onTitle={onTitle}
          onBell={onBell}
          onPaneSpawned={onPaneSpawned}
          onPaneData={onPaneData}
          onSessionId={onSessionId}
        />
      </ContextProvider>
      {/* A SIBLING of ContextProvider, never a wrapper, and never gated behind
          a conditional ancestor: either would unmount every tab layer, dispose
          each TerminalPane and orphan its pty. Opening settings must not be
          able to kill a running Claude session. */}
      <SettingsModal open={settingsOpen} sections={sections} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
