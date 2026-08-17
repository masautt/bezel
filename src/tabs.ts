// Pure tab-state logic. Zero imports on purpose: this file is compiled by all
// four tsconfig projects (root, tests, client, electron), so it must not pull
// in DOM or Node types. Every exported function returns a NEW state and
// returns the input unchanged when the action is a no-op, so React can skip
// re-rendering on a miss.

/** What a pane runs. The old `PaneId`, renamed now that it no longer identifies a pty. */
export type PaneRole = 'claude' | 'shell'

/** What identifies a pty: `${tabId}:${role}`. */
export type PaneKey = string

export interface Tab {
  /** Monotonic, never reused — see the note on `nextId`. */
  id: number
  cwd: string
  /**
   * Distinct session summaries, newest first. `history[0]` is the current one;
   * an empty array means claude has not reported a usable title yet.
   *
   * This REPLACES an earlier `title: string | null`. One array rather than a
   * scalar plus a list means the tab label and the session widget read the same
   * value and cannot disagree.
   */
  history: string[]
  /** True between the first and second click of the two-step close. */
  closeArmed: boolean
  /**
   * The session rang the terminal bell (BEL) while you were not watching it —
   * claude finishing a turn, a build ending, a shell command asking for input.
   *
   * "Not watching" is the caller's judgement, not this module's: it owns the
   * window's focus state. What this module guarantees is the other half —
   * activating a tab clears its flag, so the mark can never outlive the look.
   */
  attention: boolean
  /**
   * The uuid this tab's claude pty was spawned with (`--session-id`), learned
   * from the spawn ack. Absent for a tab whose claude has not started — a
   * restored tab not yet activated, or a spawn that failed. This is what makes
   * a restore a `--resume` rather than a fresh conversation.
   */
  claudeSessionId?: string
}

export interface TabsState {
  tabs: Tab[]
  activeId: number
  /**
   * Source of the next id. Never decremented, even as tabs close. A recycled
   * id would let a late pty:data/pty:exit from a closed tab land on a new one,
   * bleeding one session's output into another terminal.
   */
  nextId: number
}

/** Entries kept per tab. Older summaries fall off the tail. */
export const MAX_HISTORY = 20

export function paneKey(tabId: number, role: PaneRole): PaneKey {
  return `${tabId}:${role}`
}

export function parsePaneKey(key: PaneKey): { tabId: number; role: PaneRole } | null {
  const match = /^(\d+):(claude|shell)$/.exec(key)
  if (!match) return null
  return { tabId: Number(match[1]), role: match[2] as PaneRole }
}

/** Returns the same array when nothing was armed, so callers stay reference-stable. */
function disarm(tabs: Tab[]): Tab[] {
  if (!tabs.some(t => t.closeArmed)) return tabs
  return tabs.map(t => (t.closeArmed ? { ...t, closeArmed: false } : t))
}

/** Returns the same array when that tab is not marked, matching `disarm`. */
function unmark(tabs: Tab[], id: number): Tab[] {
  if (!tabs.some(t => t.id === id && t.attention)) return tabs
  return tabs.map(t => (t.id === id ? { ...t, attention: false } : t))
}

export function createInitialTabs(cwd: string): TabsState {
  return { tabs: [{ id: 1, cwd, history: [], closeArmed: false, attention: false }], activeId: 1, nextId: 2 }
}

export function createTab(state: TabsState, cwd: string): TabsState {
  const tab: Tab = { id: state.nextId, cwd, history: [], closeArmed: false, attention: false }
  return { tabs: [...disarm(state.tabs), tab], activeId: tab.id, nextId: state.nextId + 1 }
}

export function closeTab(state: TabsState, id: number): TabsState {
  if (state.tabs.length <= 1) return state
  const index = state.tabs.findIndex(t => t.id === id)
  if (index === -1) return state
  const remaining = disarm(state.tabs.filter(t => t.id !== id))
  // Closing a background tab must not move the user. Closing the active one
  // lands on the right neighbor, or the left when it was the last tab.
  const activeId =
    state.activeId === id
      ? (state.tabs[index + 1] ?? state.tabs[index - 1]).id
      : state.activeId
  return { ...state, tabs: remaining, activeId }
}

export function activateTab(state: TabsState, id: number): TabsState {
  if (!state.tabs.some(t => t.id === id)) return state
  // An armed close must not survive the user's attention moving elsewhere.
  // Looking at a tab is what answers its bell, so the mark goes with it — and
  // it goes here rather than in the caller so every route in (click, Ctrl+Tab,
  // Ctrl+N, activateNext/Prev/Index, which all funnel through this) clears it.
  const tabs = unmark(disarm(state.tabs), id)
  if (id === state.activeId && tabs === state.tabs) return state
  return { ...state, tabs, activeId: id }
}

function shift(state: TabsState, delta: number): TabsState {
  const index = state.tabs.findIndex(t => t.id === state.activeId)
  if (index === -1) return state
  const count = state.tabs.length
  const next = (index + delta + count) % count
  return activateTab(state, state.tabs[next].id)
}

export function activateNext(state: TabsState): TabsState { return shift(state, 1) }
export function activatePrev(state: TabsState): TabsState { return shift(state, -1) }

/** `index` is zero-based; Ctrl+1 maps to 0. Out of range is a no-op. */
export function activateIndex(state: TabsState, index: number): TabsState {
  const tab = state.tabs[index]
  if (index < 0 || !tab) return state
  return activateTab(state, tab.id)
}

function patch(state: TabsState, id: number, change: Partial<Tab>): TabsState {
  if (!state.tabs.some(t => t.id === id)) return state
  return { ...state, tabs: state.tabs.map(t => (t.id === id ? { ...t, ...change } : t)) }
}

export function setTabCwd(state: TabsState, id: number, cwd: string): TabsState {
  const tab = state.tabs.find(t => t.id === id)
  // OSC 7 fires on every prompt whether or not the directory actually changed;
  // reference equality on a no-op is load-bearing the same way it is for
  // setTabTitle, otherwise every prompt would re-render every tab's layer.
  if (!tab || tab.cwd === cwd) return state
  return patch(state, id, { cwd })
}

/**
 * Turns a raw OSC 0 title into a tab label, or null if it is not one.
 *
 * Observed live (see the design doc's "Observed 2026-08-06"): the shell first
 * reports its own exe path, claude reports `claude` / `Claude Code` before it
 * has a summary, and the summary itself arrives behind an animated spinner
 * glyph that re-fires several times a second. Stripping the glyph makes
 * consecutive frames compare equal, which is what setTabTitle's no-op relies
 * on.
 */
export function cleanTitle(raw: string): string | null {
  // Drop a leading run of anything that is not a letter or digit: the spinner
  // glyphs (✳, ⠂, ⠐, …) and the space after them.
  const text = raw.trim().replace(/^[^\p{L}\p{N}]+/u, '').trim()
  if (!text) return null
  // The shell naming its own executable, or any path: worse than no label.
  if (/\.exe$/i.test(text) || /^[a-zA-Z]:[\\/]/.test(text)) return null
  // Placeholders that say strictly less than the repo-name fallback.
  if (/^claude( code)?$/i.test(text)) return null
  return text
}

/** `rawTitle` is the terminal's report; it is cleaned and may be rejected. */
export function setTabTitle(state: TabsState, id: number, rawTitle: string): TabsState {
  const title = cleanTitle(rawTitle)
  if (title === null) return state
  const tab = state.tabs.find(t => t.id === id)
  // Reference equality on an unchanged title is load-bearing: without it every
  // spinner frame would re-render all tabs' layers. Only the CURRENT entry is
  // compared — returning to an earlier task is a real event and gets a new row.
  if (!tab || tab.history[0] === title) return state
  return patch(state, id, { history: [title, ...tab.history].slice(0, MAX_HISTORY) })
}

/**
 * Learn the uuid a tab's claude pty actually spawned with, from the spawn
 * ack. This is what turns the NEXT cold start of this tab into a `--resume`
 * rather than a fresh conversation — see the note on `Tab.claudeSessionId`.
 *
 * Reference-stable when the id already matches, same as every other reducer
 * here: a resume's ack reports the id it was ASKED for, so this would
 * otherwise re-render every tab's layer on every restore for no change.
 */
export function recordSessionId(state: TabsState, tabId: number, sessionId: string): TabsState {
  const tab = state.tabs.find(t => t.id === tabId)
  if (!tab || tab.claudeSessionId === sessionId) return state
  return patch(state, tabId, { claudeSessionId: sessionId })
}

/**
 * A pane in this tab rang the bell. Idempotent and reference-stable: a session
 * that rings twice before you look must not re-render every tab's layer, and a
 * chatty program that bells on every prompt would otherwise do it per prompt.
 */
export function markAttention(state: TabsState, id: number): TabsState {
  const tab = state.tabs.find(t => t.id === id)
  if (!tab || tab.attention) return state
  return patch(state, id, { attention: true })
}

/**
 * Answer a tab's bell without switching to it — what the window regaining
 * focus does to the tab already in front of you. Switching tabs clears its own
 * mark; see `activateTab`.
 */
export function clearAttention(state: TabsState, id: number): TabsState {
  const tabs = unmark(state.tabs, id)
  return tabs === state.tabs ? state : { ...state, tabs }
}

export function armClose(state: TabsState, id: number): TabsState {
  // Arming the only tab is reachable now: its ✕ arms and confirms like any
  // other, and the confirming click quits the app instead of asking this
  // module to produce a zero-tab state (closeTab still refuses that, as
  // defense in depth — the caller routes the last tab's confirm around it).
  const target = state.tabs.find(t => t.id === id)
  if (!target) return state
  // Already armed: every other tab must already be disarmed too, since arming
  // one always disarms the rest. Reference-stable, matching disarm/disarmAll/
  // setTabCwd/setTabTitle/activateTab's no-op contract.
  if (target.closeArmed) return state
  return { ...state, tabs: state.tabs.map(t => ({ ...t, closeArmed: t.id === id })) }
}

export function disarmAll(state: TabsState): TabsState {
  const tabs = disarm(state.tabs)
  return tabs === state.tabs ? state : { ...state, tabs }
}

/**
 * What the tab strip shows. The newest session summary wins; until one arrives
 * (and forever in a tab where claude is never prompted) the caller-resolved
 * repo/org name stands in. `repo` and `org` come from `resolveProjectPath`.
 */
export function tabLabel(tab: Tab, repo: string | null, org: string | null): string {
  return tab.history[0]?.trim() || repo || org || 'source'
}

/** What a spawn asks for. `new` lets main assign the uuid; `resume` names one. */
export type SessionIntent = { mode: 'new' } | { mode: 'resume'; id: string }

/** A tab as it survives to disk. Transient flags are deliberately not stored. */
export interface PersistedTab {
  id: number
  cwd: string
  claudeSessionId?: string
  history: string[]
}

export interface PersistedTabs {
  tabs: PersistedTab[]
  activeId: number
  nextId: number
}

export function toPersisted(state: TabsState): PersistedTabs {
  return {
    tabs: state.tabs.map(t => {
      const out: PersistedTab = { id: t.id, cwd: t.cwd, history: t.history }
      // Written only when present: an undefined key would serialize as absent
      // anyway, and an explicit `claudeSessionId: undefined` in the object makes
      // the toEqual assertions in the tests lie about what was stored.
      if (t.claudeSessionId) out.claudeSessionId = t.claudeSessionId
      return out
    }),
    activeId: state.activeId,
    nextId: state.nextId,
  }
}

/**
 * The one definition of what a claude session id may look like, shared with
 * `electron/pty-manager.ts` (which imports it relatively — see the note there).
 *
 * A uuid is hex and dashes, so it needs no quoting when it is spliced into the
 * pane's PowerShell `-Command` string — PROVIDED it actually is one. Anything
 * that is not exactly a 36-character hex-and-dash string is refused outright
 * rather than escaped: there is no legitimate id shape this rejects, and
 * refusing is simpler to get right than quoting.
 *
 * It lives HERE, not in electron/, because the check has to be applied at both
 * ends of the same value. Only checking it at spawn is what let a hand-edited
 * config.json poison a tab permanently: the flag was silently dropped, claude
 * started a fresh conversation, and the renderer re-recorded the bogus id back
 * to disk on every launch.
 */
export const UUID_RE = /^[0-9a-fA-F-]{36}$/

function parseTab(raw: unknown): Tab | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<PersistedTab>
  if (typeof o.id !== 'number' || !Number.isInteger(o.id) || o.id < 1) return null
  if (typeof o.cwd !== 'string' || o.cwd.length === 0) return null
  const history = Array.isArray(o.history)
    ? o.history.filter((h): h is string => typeof h === 'string').slice(0, MAX_HISTORY)
    : []
  const tab: Tab = { id: o.id, cwd: o.cwd, history, closeArmed: false, attention: false }
  // Shape-checked, not merely non-empty: a value that fails this would produce
  // no `--resume` flag at spawn, so claude would start a NEW conversation while
  // the pane said "resuming session…" and the id was written straight back to
  // disk. Dropping it degrades the tab to `{ mode: 'new' }` with a real, minted,
  // recordable uuid — one bad id costs one conversation, once.
  if (typeof o.claudeSessionId === 'string' && UUID_RE.test(o.claudeSessionId)) {
    tab.claudeSessionId = o.claudeSessionId
  }
  return tab
}

/**
 * Validate and repair rather than trust — the same stance parseStore takes for
 * `layout`, and for the same reason: config.json is hand-editable by design and
 * a bad edit must not be able to crash a render. One corrupt entry costs one
 * tab, not the whole set. Returns null when there is nothing usable, which the
 * caller reads as "start fresh".
 */
export function parseTabs(raw: unknown): TabsState | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return null }
  }
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Partial<PersistedTabs>
  if (!Array.isArray(obj.tabs)) return null

  const seen = new Set<number>()
  const tabs: Tab[] = []
  for (const entry of obj.tabs) {
    const tab = parseTab(entry)
    if (!tab || seen.has(tab.id)) continue
    seen.add(tab.id)
    tabs.push(tab)
  }
  if (tabs.length === 0) return null

  const activeId = typeof obj.activeId === 'number' && seen.has(obj.activeId)
    ? obj.activeId
    : tabs[0].id

  // nextId is persisted rather than recomputed, but a hand-edited or truncated
  // file can still name one that would recycle a live id — and a recycled id
  // lets a late pty:data from a closed tab bleed into a new one. Clamp above
  // every id we actually restored.
  const maxId = tabs.reduce((max, t) => (t.id > max ? t.id : max), 0)
  const nextId = typeof obj.nextId === 'number' && Number.isInteger(obj.nextId) && obj.nextId > maxId
    ? obj.nextId
    : maxId + 1

  return { tabs, activeId, nextId }
}
