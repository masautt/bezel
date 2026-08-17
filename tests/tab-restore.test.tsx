import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'

// Same reasoning as tests/app-tabs.test.tsx: xterm does not run meaningfully
// under jsdom, so TerminalPane is replaced with a stand-in that mirrors just
// enough of the real mount-once spawn effect to make "which panes spawned"
// assertions meaningful. `onSpawned`/`onFirstData` are fired once the mocked
// spawn resolves, mirroring the real component closely enough for the
// launch-screen-release test below (which needs `panesLive` to become true).
const { mounts } = vi.hoisted(() => ({ mounts: [] as string[] }))

vi.mock('../client/src/TerminalPane', () => ({
  TerminalPane: ({ id, cwd, intent, onSpawned, onFirstData }: {
    id: string
    cwd: string
    intent: { mode: 'new' } | { mode: 'resume'; id: string }
    onSpawned?: () => void
    onFirstData?: () => void
  }) => {
    useEffect(() => {
      mounts.push(id)
      void window.bezel.pty.spawn(id, cwd, intent).then(() => {
        onSpawned?.()
        onFirstData?.()
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
    return null
  },
}))

import { App } from '../client/src/App'

const ROOT = 'C:/Users/testuser/source'

// Real uuid shapes, not placeholders: parseTab now refuses a `claudeSessionId`
// that is not one (a bogus id produced no `--resume` flag at spawn and started
// a silently-fresh conversation), so a fixture spelled `uuid-a` would restore
// as a tab with NO session id and these tests would assert nothing.
const SESSION_A = 'aaaaaaaa-1111-4222-8333-444444444444'
const SESSION_B = 'bbbbbbbb-1111-4222-8333-444444444444'

const persisted = {
  tabs: [
    { id: 1, cwd: 'C:\\src\\a', claudeSessionId: SESSION_A, history: ['first tab work'] },
    { id: 2, cwd: 'C:\\src\\b', claudeSessionId: SESSION_B, history: ['second tab work'] },
  ],
  activeId: 1,
  nextId: 3,
}

/** Three tabs, none of them 2 or 3 ever visited — the repro for the "close an
 *  active, never-visited restored tab" bug: closeTab picks a geometric
 *  neighbor as the new active tab, which has no relationship to `booted`. */
const persistedThree = {
  tabs: [
    { id: 1, cwd: 'C:\\src\\a', history: ['first tab work'] },
    { id: 2, cwd: 'C:\\src\\b', history: ['second tab work'] },
    { id: 3, cwd: 'C:\\src\\c', history: ['third tab work'] },
  ],
  activeId: 1,
  nextId: 4,
}

/** Mirrors the established mock shape from tests/app-tabs.test.tsx. */
function stubBridge() {
  const kill = vi.fn().mockResolvedValue(undefined)
  const spawn = vi.fn().mockResolvedValue(undefined)
  const remember = vi.fn().mockResolvedValue(undefined)
  const off = () => {}
  window.bezel = {
    ...window.bezel,
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
      remember: vi.fn().mockResolvedValue(undefined),
      rememberRepo: vi.fn().mockResolvedValue(undefined),
      last: vi.fn().mockResolvedValue({ cwd: ROOT, repoRoot: null }),
      // Every fixture's cwd exists by default, so this suite's pre-existing
      // tests keep restoring and booting exactly as before. Individual tests
      // override this to exercise the missing-directory path.
      exists: vi.fn().mockResolvedValue(true),
      // Likewise for the remembered session: present by default, so the resume
      // fixtures keep resuming. Individual tests override it to exercise the
      // ghost-session path (an id whose transcript claude never wrote).
      sessionExists: vi.fn().mockResolvedValue(true),
    },
    clipboard: {
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(''),
    },
    tabs: {
      remember,
      last: vi.fn().mockResolvedValue(null),
    },
    openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.bezel
}

beforeEach(() => {
  vi.useRealTimers()
  mounts.length = 0
})

describe('tab restore', () => {
  it('restores every remembered tab into the strip', async () => {
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persisted)
    render(<App />)
    // getByRole('button', …), not getByText: the ACTIVE tab's label text is
    // deliberately echoed by the Session gutter widget below it (same
    // history[0]), so a plain text query is ambiguous for tab 1. Scoping to
    // the tab-strip button is what the brief's assertion actually means —
    // "this tab is in the strip" — and stays unambiguous for both tabs.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'first tab work' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'second tab work' })).toBeTruthy()
    })
  })

  it('spawns only the active tab, leaving the rest dormant', async () => {
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persisted)
    render(<App />)
    await waitFor(() => {
      const keys = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(keys).toContain('1:claude')
      expect(keys).not.toContain('2:claude')
    })
  })

  it('falls back to a single fresh tab when nothing is remembered', async () => {
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(null)
    window.bezel.project.last = vi.fn().mockResolvedValue({ cwd: 'C:\\src', repoRoot: null })
    render(<App />)
    await waitFor(() => {
      const call = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls
        .find(c => c[0] === '1:claude')!
      expect(call[2]).toEqual({ mode: 'new' })
    })
  })

  it('remembers the set after a tab change', async () => {
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persisted)
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(window.bezel.tabs.remember).toHaveBeenCalled())
    ;(window.bezel.tabs.remember as ReturnType<typeof vi.fn>).mockClear()

    // The actual change: open a third tab. The snapshot that follows must
    // reflect it, not just the post-restore state that was already there.
    await user.click(screen.getByRole('button', { name: 'New tab' }))

    await waitFor(() => {
      const last = (window.bezel.tabs.remember as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
      expect(last?.tabs.map((t: { id: number }) => t.id)).toEqual([1, 2, 3])
      expect(last?.nextId).toBe(4)
    })
  })

  it('boots the new active tab after closing a restored, never-visited active tab', async () => {
    // Repro: activeId is 1 (booted), tabs 2 and 3 are never clicked.
    // closeTab lands the new activeId on a geometric neighbor (index+1, else
    // index-1) — here tab 2 — which has no relationship to activation
    // history. Without booting it on close, tab 2 becomes active with its
    // pane pair permanently gated out.
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persistedThree)
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'first tab work' })).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Close first tab work' }))
    await user.click(screen.getByRole('button', { name: 'Click again to close first tab work' }))

    await waitFor(() => {
      const keys = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(keys).toContain('2:claude')
      expect(keys).toContain('2:shell')
      // Tab 3 was never activated either and stays dormant.
      expect(keys).not.toContain('3:claude')
    })
  })

  it('does not resume a session whose transcript no longer exists', async () => {
    // The bug this closes, seen in the wild: bezel assigns a session id at
    // spawn, but claude writes the transcript only once the session has
    // content. Open a tab, never type in it, quit — and the id is remembered
    // for a conversation that was never created. Restoring it ran
    // `--resume <uuid>` and claude answered "No conversation found with session
    // ID" into the pane. The failed-resume heuristic could not catch it either:
    // claude PRINTS that error rather than exiting silently, so the no-bytes
    // half of that rule was false and the branch never fired.
    stubBridge()
    const ghosted = {
      tabs: [{ id: 1, cwd: 'C:\src\a', claudeSessionId: SESSION_A, history: ['never typed in this one'] }],
      activeId: 1,
      nextId: 2,
    }
    window.bezel.tabs.last = vi.fn().mockResolvedValue(ghosted)
    window.bezel.project.sessionExists = vi.fn().mockResolvedValue(false)
    render(<App />)

    await waitFor(() => {
      const call = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === '1:claude')
      expect(call?.[2]).toEqual({ mode: 'new' })
    })
    expect(window.bezel.project.sessionExists).toHaveBeenCalledWith(SESSION_A, 'C:\src\a')
  })

  it('still resumes when the transcript is there', async () => {
    // The other half of the pair: the check must not have turned every resume
    // into a fresh session.
    stubBridge()
    const kept = {
      tabs: [{ id: 1, cwd: 'C:\src\a', claudeSessionId: SESSION_A, history: ['real work'] }],
      activeId: 1,
      nextId: 2,
    }
    window.bezel.tabs.last = vi.fn().mockResolvedValue(kept)
    window.bezel.project.sessionExists = vi.fn().mockResolvedValue(true)
    render(<App />)

    await waitFor(() => {
      const call = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === '1:claude')
      expect(call?.[2]).toEqual({ mode: 'resume', id: SESSION_A })
    })
  })

  it('resumes a restored tab by its remembered id', async () => {
    // Moved here from Task 4's brief: this cannot pass until TerminalPane
    // accepts an `intent` prop (Task 5), which is what App threads through.
    stubBridge()
    const user = userEvent.setup()
    const mixed = {
      tabs: [
        { id: 1, cwd: 'C:\\src\\a', claudeSessionId: SESSION_A, history: ['first tab work'] },
        { id: 2, cwd: 'C:\\src\\b', history: ['second tab work'] },
      ],
      activeId: 1,
      nextId: 3,
    }
    window.bezel.tabs.last = vi.fn().mockResolvedValue(mixed)
    render(<App />)

    await waitFor(() => {
      const call = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === '1:claude')
      expect(call?.[2]).toEqual({ mode: 'resume', id: SESSION_A })
    })

    // Tab 2 has no remembered session id and is not yet booted. Activating it
    // must spawn its claude pane fresh, and its shell pane — which never
    // resumes — fresh too.
    await user.click(screen.getByRole('button', { name: 'second tab work' }))
    await waitFor(() => {
      const claudeCall = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === '2:claude')
      expect(claudeCall?.[2]).toEqual({ mode: 'new' })
      const shellCall = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === '2:shell')
      expect(shellCall?.[2]).toEqual({ mode: 'new' })
    })
  })

  it('marks an unbooted tab as dormant and drops the mark once booted', async () => {
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persisted)
    const user = userEvent.setup()
    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.querySelectorAll('.tab-dormant')).toHaveLength(1)
    })
    // Which tab carries it matters, not just the count: tab 1 is the active,
    // booted tab and must NOT be dormant; tab 2 was restored but never
    // activated and must be the one that is.
    const tab1 = screen.getByRole('button', { name: 'first tab work' }).closest('.tab')
    const tab2 = screen.getByRole('button', { name: 'second tab work' }).closest('.tab')
    expect(tab1).not.toHaveClass('tab-dormant')
    expect(tab2).toHaveClass('tab-dormant')

    // Activating tab 2 boots it, and the mark should drop.
    await user.click(screen.getByRole('button', { name: 'second tab work' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.tab-dormant')).toHaveLength(0)
    })
  })

  it('flags a tab whose directory is gone instead of spawning into it', async () => {
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persisted)
    window.bezel.project.exists = vi.fn().mockImplementation((p: string) => Promise.resolve(p !== 'C:\\src\\b'))
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.tab-missing')).toBeTruthy())
    // Tab 2's cwd is the one reported missing above — the mark has to land on
    // that specific row, not just exist somewhere in the strip.
    const tab2 = screen.getByRole('button', { name: 'second tab work' }).closest('.tab')
    expect(tab2).toHaveClass('tab-missing')
    // Both panes gate together today (`booted` is a single set with no
    // per-pane granularity), but the assertion should pin that requirement
    // directly rather than stand in for it with only one pane checked.
    const spawnedKeys = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    expect(spawnedKeys).not.toContain('2:shell')
    expect(spawnedKeys).not.toContain('2:claude')
  })

  it('releases the launch screen when the FIRST restored tab is missing but a later one is not', async () => {
    // Regression cover: `panesLive` used to gate on `tabs.tabs[0]`
    // unconditionally. A tab in `missing` never boots, so if it happened to
    // be first, `panesLive` could never become true and the app fell through
    // to the 45s `launchTimedOut` fallback — even with a perfectly healthy
    // second tab. Tab 1 here is the missing one; tab 2 is active and healthy,
    // so it is the one that actually boots and must be what gates the screen.
    stubBridge()
    const missingFirst = {
      tabs: [
        { id: 1, cwd: 'C:\\src\\a', history: ['first tab work'] },
        { id: 2, cwd: 'C:\\src\\b', history: ['second tab work'] },
      ],
      activeId: 2,
      nextId: 3,
    }
    window.bezel.tabs.last = vi.fn().mockResolvedValue(missingFirst)
    window.bezel.project.exists = vi.fn().mockImplementation((p: string) => Promise.resolve(p !== 'C:\\src\\a'))
    const { container } = render(<App />)

    await waitFor(() => {
      // Both conditions matter: the pre-tabs branch ALSO renders a bare
      // `.app` (no `launching` modifier — see the note above `if (!tabs)`),
      // so checking the class alone would pass trivially before tabs ever
      // load. The tab strip only renders once tabs exist, so its presence is
      // what proves this is the real "launch finished" state, not the first
      // frame.
      expect(container.querySelector('.tabstrip')).toBeTruthy()
      expect(container.querySelector('.app')).not.toHaveClass('launching')
    }, { timeout: 5000 })
  }, 10000)

  it('releases the launch screen when the active tab is not the leftmost and NOTHING is missing', async () => {
    // The test above passes for a configuration-specific reason: tab 1 is in
    // `missing`, so a `find(t => !missing.has(t.id))` gate skips past it and
    // happens to land on the active tab. Take the missing mark away and the
    // two diverge — the gate names tab 1, which is perfectly bootable but
    // DORMANT (only `restored.activeId` is booted), so its panes never mount,
    // `panesLive` never becomes true, and the full-window overlay sits over a
    // window whose active tab is already working for the whole 45s fallback.
    // This is every relaunch for anyone who quits with tab 2+ focused.
    stubBridge()
    const activeSecond = {
      tabs: [
        { id: 1, cwd: 'C:\\src\\a', history: ['first tab work'] },
        { id: 2, cwd: 'C:\\src\\b', history: ['second tab work'] },
      ],
      activeId: 2,
      nextId: 3,
    }
    window.bezel.tabs.last = vi.fn().mockResolvedValue(activeSecond)
    // Both directories exist — no tab is missing.
    window.bezel.project.exists = vi.fn().mockResolvedValue(true)
    const { container } = render(<App />)

    await waitFor(() => {
      expect(container.querySelector('.tabstrip')).toBeTruthy()
      expect(container.querySelector('.app')).not.toHaveClass('launching')
    }, { timeout: 5000 })
  }, 10000)

  it('releases the launch screen when the ACTIVE tab is missing but a sibling is not', async () => {
    // Nothing boots at all in this configuration: `booted` starts empty
    // because the active tab's directory is gone, and no other tab boots on
    // restore. `allMissing` was false — only ONE tab is missing — so the gate
    // waited on panes that will never spawn, and the full-window overlay sat
    // for the whole 45s fallback. Reachable by deleting or renaming the
    // directory of whichever tab you happened to quit with focused.
    stubBridge()
    const activeMissing = {
      tabs: [
        { id: 1, cwd: 'C:\\src\\a', history: ['first tab work'] },
        { id: 2, cwd: 'C:\\src\\b', history: ['second tab work'] },
      ],
      activeId: 2,
      nextId: 3,
    }
    window.bezel.tabs.last = vi.fn().mockResolvedValue(activeMissing)
    // Only the ACTIVE tab's directory is gone. The sibling is fine — which is
    // exactly what kept `allMissing` from catching this.
    window.bezel.project.exists = vi.fn().mockImplementation((p: string) => Promise.resolve(p !== 'C:\\src\\b'))
    const { container } = render(<App />)

    await waitFor(() => {
      expect(container.querySelector('.tabstrip')).toBeTruthy()
      expect(container.querySelector('.app')).not.toHaveClass('launching')
    }, { timeout: 5000 })
  }, 10000)

  it('does not overwrite the remembered set when tabs:last rejects', async () => {
    // The persist effect fires on the first non-null `tabs`, so the fallback
    // single fresh tab reached main's 1s queue ~immediately and the stored set
    // — every tab's cwd, history and session id — was gone with no recovery.
    // One flaky IPC round-trip must not be able to do that. Task 6 applied
    // exactly this reasoning one level down (a rejected per-tab
    // `project.exists` fails closed for that tab only); this is the same at
    // the level above.
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockRejectedValue(new Error('IPC hiccup'))
    render(<App />)

    // The window still comes up on a fresh tab — failing closed means not
    // WRITING, not refusing to run.
    await waitFor(() => {
      const keys = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(keys).toContain('1:claude')
    })
    expect(window.bezel.tabs.remember).not.toHaveBeenCalled()
  })

  it('does not overwrite a stored set that parses as unusable', async () => {
    // A truncated write leaves a `tabs` key that parseTabs rejects. That is
    // indistinguishable from garbage, but it is NOT the same as no key at
    // all — there was a set here, and replacing it with one fresh tab a
    // second later throws away the only copy. Nothing remembered (below) is
    // the genuine first-launch path and still writes normally.
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue({ tabs: 'truncat' })
    render(<App />)

    await waitFor(() => {
      const keys = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(keys).toContain('1:claude')
    })
    expect(window.bezel.tabs.remember).not.toHaveBeenCalled()
  })

  it('still remembers the set on a genuine first launch', async () => {
    // The guard above must not turn into "never persist until you have
    // already persisted". No `tabs` key at all means nothing to protect.
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(null)
    render(<App />)
    await waitFor(() => expect(window.bezel.tabs.remember).toHaveBeenCalled())
  })

  it('keeps the rest of the restored set when one tab’s existence check rejects', async () => {
    // Before this fix, the per-tab `project.exists` calls sat inside the SAME
    // promise chain the outer `.catch` covers — one rejection (a flaky IPC
    // round-trip, not even a real "missing" answer) fell all the way through
    // to the "nothing remembered" fallback and discarded every other tab's
    // session and history along with it.
    stubBridge()
    window.bezel.tabs.last = vi.fn().mockResolvedValue(persisted)
    window.bezel.project.exists = vi.fn().mockImplementation((p: string) =>
      p === 'C:\\src\\b' ? Promise.reject(new Error('IPC hiccup')) : Promise.resolve(true)
    )
    render(<App />)

    // Both tabs restore — the rejection cost tab 2 nothing but being marked
    // missing (fail closed), not the whole set.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'first tab work' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'second tab work' })).toBeTruthy()
    })
    // Tab 1's healthy cwd still boots normally.
    await waitFor(() => {
      const keys = (window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(keys).toContain('1:claude')
    })
    // Tab 2 — the one whose check rejected — reads as missing, not booted.
    const tab2 = screen.getByRole('button', { name: 'second tab work' }).closest('.tab')
    expect(tab2).toHaveClass('tab-missing')
  })
})
