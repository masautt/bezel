import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Same TerminalPane stand-in as the other App suites: xterm does not run under
// jsdom. Nothing here reaches a pane anyway — the whole point is the state
// BEFORE any tab exists — but App imports it at module load.
vi.mock('../client/src/TerminalPane', () => ({
  TerminalPane: () => null,
}))

import { App } from '../client/src/App'

const ROOT = 'C:/Users/testuser/source'
const off = () => {}

/**
 * A bridge whose `project.last()` never settles, holding App in the pre-tabs
 * branch for the life of the test. That branch is otherwise unreachable: every
 * other suite awaits its way out of it before asserting anything.
 */
function stubBridge(last: Promise<{ cwd: string; repoRoot: string | null }>) {
  window.bezel = {
    ...window.bezel,
    // AppBar renders nothing at all unless this is true.
    isElectron: true,
    isDev: false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChange: vi.fn().mockReturnValue(off),
    pty: {
      spawn: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(off),
      onExit: vi.fn().mockReturnValue(off),
    },
    apps: { list: vi.fn().mockResolvedValue([]) },
    git: { info: vi.fn().mockResolvedValue({ branch: null, ahead: 0, dirty: [] }) },
    specs: { list: vi.fn().mockResolvedValue(null) },
    project: {
      remember: vi.fn().mockResolvedValue(undefined),
      rememberRepo: vi.fn().mockResolvedValue(undefined),
      last: vi.fn().mockReturnValue(last),
    },
    openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.bezel
}

describe('the launch screen keeps the window controls', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the window controls while the remembered cwd is still resolving', () => {
    // Never resolves: this is the first-paint state, before there are tabs.
    stubBridge(new Promise(() => {}))
    const { container } = render(<App />)

    // The launch screen is up...
    expect(screen.getByRole('status')).toHaveTextContent('starting your terminals')
    // ...and the window is still operable. Before this, the pre-tabs branch
    // returned the screen alone, so startup was the one time you could not
    // close, minimize or maximize the window.
    //
    // Matched by class, not accessible name: react-ui labels these with `title`
    // and a glyph child, so the computed name is the glyph ("✕"), not "Close".
    expect(container.querySelectorAll('.ds-appbar-btn')).toHaveLength(3)
    expect(container.querySelector('.ds-appbar-close')).not.toBeNull()
  })

  it('wires those controls to the bridge', () => {
    stubBridge(new Promise(() => {}))
    const { container } = render(<App />)

    container.querySelector<HTMLButtonElement>('.ds-appbar-close')!.click()
    expect(window.bezel.close).toHaveBeenCalled()
  })

  it('offers the brand as a working settings button while loading', () => {
    stubBridge(new Promise(() => {}))
    const { container } = render(<App />)

    const brand = screen.getByRole('button', { name: /settings/i })
    expect(brand).toBeInTheDocument()
    // The modal has to be rendered in THIS branch too, or the brand is a button
    // that sets state and shows nothing.
    expect(container.querySelector('[data-testid="settings-backdrop"]')).toBeNull()
    // act(), because opening the dialog is a state update: a bare .click()
    // dispatches the event but leaves the re-render unflushed.
    act(() => brand.click())
    expect(container.querySelector('[data-testid="settings-backdrop"]')).not.toBeNull()
  })

  it('shows no tab strip or new-tab button before the panes are live', () => {
    stubBridge(new Promise(() => {}))
    const { container } = render(<App />)

    // Every target in the strip needs main, which is blocked in nodePty.spawn
    // for the whole launch — so they would paint as controls that do nothing.
    expect(container.querySelector('.tabstrip')).toBeNull()
    expect(container.querySelector('.tab-new')).toBeNull()
  })

  it('still hides the strip once tabs exist but the panes are not live yet', async () => {
    // The state actually reported: the remembered cwd HAS answered, so there is
    // a tab, but pty.spawn has not returned, so the launch screen is still up.
    // The strip was painting a real tab and a ＋ over it.
    stubBridge(Promise.resolve({ cwd: ROOT, repoRoot: null }))
    // Never settles: this is what keeps launchReady false.
    window.bezel.pty.spawn = vi.fn().mockReturnValue(new Promise(() => {}))
    const { container } = render(<App />)

    await waitFor(() => expect(container.querySelector('.loading-screen')).not.toBeNull())
    // The strip stays MOUNTED and is hidden by `.app.launching .tabstrip`
    // (jsdom loads no stylesheet, so the class is the only observable here —
    // the rule itself is guarded in tests/appbar-css.test.ts).
    expect(container.querySelector('.app')).toHaveClass('launching')
    // ...and the bar's working controls are still there.
    expect(container.querySelectorAll('.ds-appbar-btn')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
  })

  it('keeps the same launch screen element once tabs arrive', async () => {
    // The pre-tabs branch and the shell branch both put the screen in the FIRST
    // child slot precisely so React reconciles it instead of remounting — a
    // remount throws away the message picked at first paint and replays the
    // fade, which reads as a flicker. Adding the bar must not disturb that.
    let settle: (v: { cwd: string; repoRoot: string | null }) => void = () => {}
    stubBridge(new Promise(resolve => { settle = resolve }))
    const { container } = render(<App />)

    const before = container.querySelector('.loading-screen')
    expect(before).not.toBeNull()

    settle({ cwd: ROOT, repoRoot: null })
    // Waiting on the shell, not on the ＋: the strip is deliberately absent
    // until the panes are live, and TerminalPane is a no-op here so that never
    // happens. `.grid` only exists in the tabs branch, which is the transition
    // this test is about.
    await waitFor(() => expect(container.querySelector('.grid')).not.toBeNull())

    // Same DOM node, not a replacement.
    expect(container.querySelector('.loading-screen')).toBe(before)
  })
})
