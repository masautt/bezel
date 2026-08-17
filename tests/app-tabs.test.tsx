import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { DWELL_MS } from '../src/title-settler'

// xterm does not run meaningfully under jsdom (no canvas, no real layout), and
// this suite is about App's tab state, not the terminal. The mock still has to
// behave like a real mounted component for the two invariants below that a
// no-op `() => null` mock would silently let regress:
//
//   - mount-once: a keyed-remount bug (e.g. `<ContextProvider>` or a layer
//     keyed on something that changes across a switch) would respawn a pty
//     that is already running. `mounts` records every mount by pane key so a
//     test can assert the count never grows across a switch or an unrelated
//     close.
//   - the `project:remember` gate: only the ACTIVE tab's OSC 7 may persist the
//     launch directory. `oscHandlers` exposes each mounted pane's `onOsc` so a
//     test can fire a realistic OSC 7 payload as if from a specific tab's
//     shell, from outside the component tree.
const { mounts, oscHandlers, titleHandlers } = vi.hoisted(() => ({
  mounts: [] as string[],
  oscHandlers: new Map<string, (payload: string) => void>(),
  titleHandlers: new Map<string, (title: string) => void>(),
}))

vi.mock('../client/src/TerminalPane', () => ({
  TerminalPane: ({ id, cwd, onOsc, onTitle }: { id: string; cwd: string; onOsc?: (payload: string) => void; onTitle?: (title: string) => void }) => {
    // Mirrors the real mount-once spawn effect closely enough to make the
    // "spawned exactly once per pane" assertion meaningful: a remount would
    // spawn a second pty for a pane that already has one running.
    useEffect(() => {
      mounts.push(id)
      void window.bezel.pty.spawn(id, cwd, { mode: 'new' })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
    // Recorded every render (not just on mount) so the handler always
    // reflects the current closure, the same way the real onOscRef does.
    oscHandlers.set(id, onOsc ?? (() => {}))
    titleHandlers.set(id, onTitle ?? (() => {}))
    return null
  },
}))

import { App } from '../client/src/App'

const ROOT = 'C:/Users/testuser/source'

function stubBridge() {
  const kill = vi.fn().mockResolvedValue(undefined)
  const spawn = vi.fn().mockResolvedValue(undefined)
  const remember = vi.fn().mockResolvedValue(undefined)
  const off = () => {}
  window.bezel = {
    ...window.bezel,
    // AppBar renders NOTHING (tab strip included) unless this is true.
    isElectron: true,
    isDev: false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChange: vi.fn().mockReturnValue(off),
    pty: {
      spawn,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill,
      onData: vi.fn().mockReturnValue(off),
      onExit: vi.fn().mockReturnValue(off),
    },
    apps: { list: vi.fn().mockResolvedValue([]) },
    git: { info: vi.fn().mockResolvedValue({ branch: null, ahead: 0, dirty: [] }) },
    specs: { list: vi.fn().mockResolvedValue(null) },
    project: {
      remember,
      rememberRepo: vi.fn().mockResolvedValue(undefined),
      last: vi.fn().mockResolvedValue({ cwd: ROOT, repoRoot: null }),
    },
    openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.bezel
  return { kill, spawn, remember }
}

/**
 * Report a terminal title and let it become the tab's label.
 *
 * App debounces titles through the settler (src/title-settler.ts), so a title
 * only lands once it has held for DWELL_MS. Fake timers are switched on HERE
 * rather than for the whole test: `renderApp` and userEvent both need real
 * ones, and a title cannot be pending across the swap because this advances
 * past the dwell before handing them back.
 */
async function settleTitle(pane: string, title: string) {
  vi.useFakeTimers()
  try {
    titleHandlers.get(pane)!(title)
    await act(async () => { await vi.advanceTimersByTimeAsync(DWELL_MS) })
  } finally {
    vi.useRealTimers()
  }
}

/** Renders App and waits out the async `project.last()` that gates the shell. */
async function renderApp() {
  const bridge = stubBridge()
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'New tab' })
  // The strip appears as soon as tab state resolves, but the first tab's panes
  // spawn a tick later — and since tab restore became async (tabs:last →
  // parseTabs → a project:exists per tab), "later" can land after a test has
  // already snapshotted spawn/kill counts. Several tests here assert that some
  // interaction touched NO pty, which silently becomes an assertion about
  // whether the launch spawns beat the snapshot. Wait for the pane pair so the
  // baseline is the settled app, not a race.
  await waitFor(() => expect(bridge.spawn.mock.calls.length).toBeGreaterThanOrEqual(2))
  return { ...bridge, user }
}

/** The tab strip's ✕ buttons, in strip order. The AppBar's own window Close
 *  button is excluded by matching the per-tab labels only. */
function closeButtons() {
  return screen.queryAllByRole('button', { name: /^(Close|Click again to close) / })
}

/** The tab strip's label buttons, in strip (creation) order. All tabs here
 *  share the label 'source' (no repo roots, no reported title), so index —
 *  not accessible name — is what distinguishes tab 1 from tab 2 from tab 3. */
function tabButtons() {
  return screen.getAllByRole('button', { name: 'source' })
}

beforeEach(() => {
  vi.useRealTimers()
  mounts.length = 0
  oscHandlers.clear()
  titleHandlers.clear()
})
afterEach(() => { vi.restoreAllMocks() })

describe('App tab close', () => {
  it('closes a tab on the second ✕ click and kills both of its ptys', async () => {
    const { user, kill } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(closeButtons()).toHaveLength(2))

    // The second tab is id 2 (createInitialTabs starts at 1, nextId 2).
    const x = closeButtons()[1]
    await user.click(x)
    await user.click(closeButtons()[1])

    // Back down to the lone tab 1, which still shows its own ✕.
    await waitFor(() => expect(closeButtons()).toHaveLength(1))
    expect(kill).toHaveBeenCalledWith('2:claude')
    expect(kill).toHaveBeenCalledWith('2:shell')
    expect(x).not.toBeInTheDocument()
  })

  // The armed state used to be signalled by color alone, and the pointer is
  // still sitting on the button after the first click — where `.tab-close:hover`
  // has ALREADY applied the accent color. That left a 1px border hue as the only
  // pixel that changed, so nothing told the user a second click was expected.
  // It now renders a checkmark on a solid accent fill, distinct from the
  // resting ✕ in both glyph and background.
  it('shows a distinct glyph and fill, not just a color change, when armed', async () => {
    const { user } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(closeButtons()).toHaveLength(2))
    expect(closeButtons()[1]).toHaveTextContent('✕')

    await user.click(closeButtons()[1])
    const armed = closeButtons()[1]
    expect(armed).toHaveClass('arming')
    expect(armed).toHaveTextContent('✓')
  })

  // A user who cannot tell the first click registered stops to work out why
  // nothing happened. That pause used to outlast the disarm window, so the
  // second click silently re-armed instead of closing — the ✕ read as dead.
  it('still closes when the user pauses to think between the two clicks', async () => {
    const { user, kill } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(closeButtons()).toHaveLength(2))

    await user.click(closeButtons()[1])
    expect(closeButtons()[1]).toHaveClass('arming')

    // Longer than a snap double-click, shorter than walking away.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 4000)) })
    expect(closeButtons()[1]).toHaveClass('arming')

    await user.click(closeButtons()[1])
    await waitFor(() => expect(closeButtons()).toHaveLength(1))
    expect(kill).toHaveBeenCalledWith('2:claude')
    expect(kill).toHaveBeenCalledWith('2:shell')
  }, 20000)

  // The safety net still has to fire: an arm left alone must not stay live so
  // long that a much later, unrelated click destroys a running claude session.
  it('forgets an armed close that is left alone', async () => {
    const { user, kill } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(closeButtons()).toHaveLength(2))

    await user.click(closeButtons()[1])
    await waitFor(() => expect(closeButtons()[1]).not.toHaveClass('arming'), { timeout: 12000 })

    await user.click(closeButtons()[1])
    expect(closeButtons()).toHaveLength(2)
    expect(kill).not.toHaveBeenCalled()
  }, 20000)
})

describe('App last tab close quits', () => {
  it('arms and, on the confirming click, kills both ptys and quits instead of leaving a zero-tab render', async () => {
    const { user, kill } = await renderApp()

    expect(closeButtons()).toHaveLength(1)
    const x = closeButtons()[0]
    await user.click(x)
    expect(closeButtons()[0]).toHaveClass('arming')
    expect(window.bezel.close).not.toHaveBeenCalled()

    await user.click(closeButtons()[0])

    expect(kill).toHaveBeenCalledWith('1:claude')
    expect(kill).toHaveBeenCalledWith('1:shell')
    expect(window.bezel.close).toHaveBeenCalled()
    // The reducer is never asked to produce an empty tab list: the single
    // tab (and its close button) is still on screen — App relies on the
    // real main process to quit, not on the renderer tearing itself down.
    expect(closeButtons()).toHaveLength(1)
  })

  it('still closes without quitting when more than one tab is open', async () => {
    const { user, kill } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(closeButtons()).toHaveLength(2))

    const x = closeButtons()[1]
    await user.click(x)
    await user.click(closeButtons()[1])

    await waitFor(() => expect(closeButtons()).toHaveLength(1))
    expect(kill).toHaveBeenCalledWith('2:claude')
    expect(kill).toHaveBeenCalledWith('2:shell')
    expect(window.bezel.close).not.toHaveBeenCalled()
  })
})

describe('App tab mount stability', () => {
  // This is the invariant that already broke once on this branch (the keyed
  // `<ContextProvider>` bug): every tab's panes stay mounted for the tab's
  // whole lifetime, and switching only toggles visibility. A `() => null`
  // mock with no identity would pass even if every switch remounted the
  // world, since a remount and a no-op look identical to it.
  it('never remounts an existing pane on a switch or an unrelated close, and spawns each pane exactly once', async () => {
    const { user, spawn } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' })) // tab 2, now active
    await waitFor(() => expect(closeButtons()).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'New tab' })) // tab 3, now active
    await waitFor(() => expect(closeButtons()).toHaveLength(3))

    // 3 tabs * 2 panes each.
    await waitFor(() => expect(mounts).toHaveLength(6))
    const mountsAfterCreate = [...mounts].sort()

    // Switch away from tab 3 and back, then close tab 1 — a DIFFERENT tab
    // from whichever is active by then.
    await user.click(tabButtons()[0]) // -> tab 1
    await user.click(tabButtons()[1]) // -> tab 2
    await user.click(tabButtons()[2]) // -> tab 3

    const x = closeButtons()[0] // tab 1's close button; tab 3 stays active
    await user.click(x)
    await user.click(closeButtons()[0])
    await waitFor(() => expect(closeButtons()).toHaveLength(2))

    // No new mounts: not from the switches, not from closing a different tab.
    expect([...mounts].sort()).toEqual(mountsAfterCreate)

    // Each surviving pane's pty was spawned exactly once across all of this.
    const spawnedKeys = spawn.mock.calls.map(call => call[0] as string)
    for (const key of ['1:claude', '1:shell', '2:claude', '2:shell', '3:claude', '3:shell']) {
      expect(spawnedKeys.filter(k => k === key)).toHaveLength(1)
    }
  })
})

describe('App project:remember gate', () => {
  // The design's second OSC 7 rule: background tabs update their own cwd, but
  // only the ACTIVE tab may persist it as the remembered launch directory —
  // otherwise a background shell silently rewrites where the next cold
  // launch starts. `client/src/App.tsx` implements this via `activeIdRef`.
  it('persists an OSC 7 from the active tab, but not from a background tab — which still updates its own cwd', async () => {
    const { user, remember } = await renderApp()

    await user.click(screen.getByRole('button', { name: 'New tab' })) // tab 2, now active
    await waitFor(() => expect(closeButtons()).toHaveLength(2))
    remember.mockClear()

    // Both payloads deliberately point OUTSIDE the orgs root (not
    // `.../source/orgs/...`), so `resolveProjectPath` resolves neither an org
    // nor a repo and the Context widget falls back to showing the raw cwd —
    // and so tab labels (title || repo || org || 'source') stay 'source',
    // keeping `tabButtons()` valid throughout.
    const activeCwd = 'C:/Users/testuser/projects/alpha'
    const backgroundCwd = 'C:/Users/testuser/projects/beta'

    // Active tab (2)'s shell reports a new cwd: must persist it.
    act(() => { oscHandlers.get('2:shell')?.(`file:///${activeCwd}`) })
    await waitFor(() => expect(remember).toHaveBeenCalledWith(activeCwd))
    remember.mockClear()

    // Background tab (1)'s shell reports a new cwd: must NOT persist it.
    act(() => { oscHandlers.get('1:shell')?.(`file:///${backgroundCwd}`) })
    expect(remember).not.toHaveBeenCalled()

    // But tab 1's own cwd DID update — observable through the gutter's
    // Context widget once tab 1 becomes active. The widget abbreviates the
    // user-profile prefix for display; `remember` above still gets the real
    // absolute path, which is what matters for restoring it.
    await user.click(tabButtons()[0])
    await waitFor(() => expect(screen.getByText('~/projects/beta')).toBeTruthy())
    expect(remember).not.toHaveBeenCalled()
  })
})

describe('layout changes and the panes', () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    localStorage.removeItem('bezel.layout')
  })

  /** The vertical gutter dividers, in DOM order: left, then right. */
  function gutterHandles() {
    return screen.getAllByRole('separator').filter(el => el.getAttribute('aria-orientation') === 'vertical')
  }

  it('keeps every tab layer mounted and every pty untouched when a gutter is resized', async () => {
    // The invariant this whole feature has to respect: a layout change must
    // never unmount a TerminalPane. Remounting one spawns a SECOND pty for the
    // same pane key, and the old process is orphaned with nothing listening.
    const { user, spawn, kill } = await renderApp()
    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(closeButtons()).toHaveLength(2))

    const before = { spawn: spawn.mock.calls.length, kill: kill.mock.calls.length, mounts: mounts.length }
    const handle = gutterHandles()[0]
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 240 }) as PointerEvent)
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 }) as PointerEvent)
      window.dispatchEvent(new MouseEvent('pointerup', {}) as PointerEvent)
    })

    expect(spawn.mock.calls.length).toBe(before.spawn)
    expect(kill.mock.calls.length).toBe(before.kill)
    expect(mounts.length).toBe(before.mounts)
  })

  it('collapsing a widget does not touch a pty either', async () => {
    const { user, spawn, kill } = await renderApp()
    const before = { spawn: spawn.mock.calls.length, kill: kill.mock.calls.length }
    // Session, not Specs: Specs renders nothing at all for a directory with no
    // project (and no specs), so it has no header to click here.
    await user.click(screen.getByRole('button', { name: 'Session' }))
    expect(screen.getByRole('button', { name: 'Session' })).toHaveAttribute('aria-expanded', 'false')
    expect(spawn.mock.calls.length).toBe(before.spawn)
    expect(kill.mock.calls.length).toBe(before.kill)
  })

  it('persists a gutter drag, debounced, to the config store', async () => {
    // The layout moved out of localStorage and into config.json with the preset
    // store, so this now asserts against the bridge — and has to outwait the
    // 400ms debounce that keeps a drag from writing once per pointermove.
    const { user } = await renderApp()
    await user.click(screen.getByRole('button', { name: 'New tab' }))
    const handle = gutterHandles()[0]
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 240 }) as PointerEvent)
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 }) as PointerEvent)
      window.dispatchEvent(new MouseEvent('pointerup', {}) as PointerEvent)
    })

    const save = window.bezel.layout.save as unknown as ReturnType<typeof vi.fn>
    await waitFor(
      () => {
        const last = save.mock.calls.at(-1)?.[0] as { live: { gutters: { left: number } } } | undefined
        expect(last?.live.gutters.left).not.toBe(240)
      },
      { timeout: 3000 }
    )
  })

  it('does not write the store back before it has finished loading', async () => {
    // The store starts as DEFAULT_STORE and is replaced by whatever config.json
    // holds. Saving during that window would overwrite a real config with the
    // defaults on every launch.
    const save = window.bezel.layout.save as unknown as ReturnType<typeof vi.fn>
    save.mockClear()
    await renderApp()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('session history in the gutter', () => {
  it('shows the active tab summaries, newest first, without remounting panes', async () => {
    await renderApp()

    // `renderApp()` only awaits the tab strip's own render; TerminalPane's
    // mount effect (which pushes into `mounts`) can still be in flight.
    // Wait for both of tab 1's panes to have mounted before snapshotting,
    // so the invariant below isn't racing a false-empty snapshot.
    await waitFor(() => expect(mounts).toHaveLength(2))

    // Captured after the initial render's mounts have settled, before any
    // title changes — a state update on every new summary must not
    // re-render the tree hosting the terminals (that would respawn ptys).
    const mountsBeforeTitles = [...mounts]

    await settleTitle('1:claude', '⠂ Adding tabs to bezel')
    await settleTitle('1:claude', '✳ Fixing the close button')

    const rows = await screen.findAllByTestId('session-entry')
    expect(rows.map(r => r.textContent)).toEqual(['Fixing the close button', 'Adding tabs to bezel'])
    expect(mounts).toEqual(mountsBeforeTitles)
  })

  // The wiring half of src/title-settler.ts: a command title that npm parks in
  // the terminal for the length of a build must never reach the tab, however
  // many of them go by. Replayed from a real recorded session — see the trace
  // in tests/title-settler.test.ts.
  it('never records a command title that the summary interrupts', async () => {
    await renderApp()
    const SUMMARY = 'Identify performance improvements for Bezel'
    await settleTitle('1:claude', SUMMARY)

    vi.useFakeTimers()
    try {
      for (const cmd of ['npm run build', 'npm', 'npm test']) {
        titleHandlers.get('1:claude')!(cmd)
        await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
        titleHandlers.get('1:claude')!(SUMMARY)
        await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(DWELL_MS) })
    } finally {
      vi.useRealTimers()
    }

    expect((await screen.findAllByTestId('session-entry')).map(r => r.textContent)).toEqual([SUMMARY])
    expect(screen.getByRole('button', { name: SUMMARY })).toBeTruthy()
  })

  it('swaps to the other tab history on a switch', async () => {
    const { user } = await renderApp()

    await settleTitle('1:claude', 'Work on tab one')
    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await settleTitle('2:claude', 'Work on tab two')

    expect((await screen.findAllByTestId('session-entry')).map(r => r.textContent))
      .toEqual(['Work on tab two'])

    // Back to tab 1 — its own history, not tab 2's.
    await user.click(screen.getByRole('button', { name: 'Work on tab one' }))
    expect((await screen.findAllByTestId('session-entry')).map(r => r.textContent))
      .toEqual(['Work on tab one'])
  })
})

describe('collapsing the shell pane', () => {
  it('parks the shell pane on a double-click and brings it back on the next one', async () => {
    const { user } = await renderApp()
    const layer = document.querySelector('.layer')!
    const divider = layer.querySelector('[role="separator"]')!

    await user.dblClick(divider)
    expect(layer.getAttribute('style')).toContain('1fr auto 0')

    await user.dblClick(divider)
    expect(layer.getAttribute('style')).not.toContain('1fr auto 0')
  })

  // The one that matters: collapsing is a LAYOUT change, not an unmount.
  // Unmounting the pane would dispose the xterm and orphan the pty, and
  // restoring would hand back a fresh shell with the scrollback gone.
  it('does not kill or respawn the shell pty when collapsed', async () => {
    const { user, kill, spawn } = await renderApp()
    const before = { kill: kill.mock.calls.length, spawn: spawn.mock.calls.length }

    await user.dblClick(document.querySelector('.layer [role="separator"]')!)

    expect(kill.mock.calls.length).toBe(before.kill)
    expect(spawn.mock.calls.length).toBe(before.spawn)
  })
})
