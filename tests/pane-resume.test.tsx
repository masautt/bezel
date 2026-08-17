import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TerminalPane } from '../client/src/TerminalPane.js'

// TerminalPane mounts a real xterm `Terminal` and a `FitAddon`, neither of
// which does anything meaningful under jsdom (no canvas). Every OTHER suite
// that touches TerminalPane sidesteps this by mocking the whole component out
// (`vi.mock('../client/src/TerminalPane', ...)` in tests/app-tabs.test.tsx,
// tests/tab-restore.test.tsx, tests/launch-appbar.test.tsx) — none of them
// render the real component, so there is no existing `@xterm/xterm` mock to
// reuse here. This is the first suite that renders TerminalPane itself, so it
// mocks just enough of `Terminal`/`FitAddon` to observe what the component
// writes to the terminal, mirroring the shape of the `window.bezel` bridge
// stubs the other suites already use.
const { termInstances } = vi.hoisted(() => ({
  termInstances: [] as {
    write: ReturnType<typeof import('vitest').vi.fn>
    keystroke: (d: string) => void
    /** Drives the clipboard key handler, the way `keystroke` drives typed input. */
    press: (e: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }) => boolean | undefined
    /** What xterm would report as selected. */
    selection: string
  }[],
}))

vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
    write = vi.fn()
    open = vi.fn()
    loadAddon = vi.fn()
    dispose = vi.fn()
    parser = { registerOscHandler: vi.fn() }
    // Links: the pane registers a file-path provider and reads the buffer
    // through it. Neither is what these suites are about; they only have to exist.
    registerLinkProvider = vi.fn()
    buffer = { active: { getLine: () => undefined } }
    // Captured so a test can simulate the user pressing a key on a dead pane
    // — the path the "offers a fresh start" rule actually lives in.
    private dataHandler: ((d: string) => void) | null = null
    onTitleChange() { return { dispose: () => {} } }
    onBell() { return { dispose: () => {} } }
    onData(cb: (d: string) => void) { this.dataHandler = cb; return { dispose: () => {} } }
    keystroke = (d: string) => this.dataHandler?.(d)
    // The clipboard key handler. Captured rather than discarded so a test can
    // drive a key combination the way `keystroke` drives typed input.
    private keyHandler: ((e: KeyboardEvent) => boolean) | null = null
    attachCustomKeyEventHandler = (h: (e: KeyboardEvent) => boolean) => { this.keyHandler = h }
    press = (e: Partial<KeyboardEvent> & { key: string }) =>
      this.keyHandler?.({ type: 'keydown', ctrlKey: false, shiftKey: false, altKey: false, ...e } as KeyboardEvent)
    selection = ''
    hasSelection = () => this.selection.length > 0
    getSelection = () => this.selection
    constructor() { termInstances.push(this) }
  }
  return { Terminal: FakeTerminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon {
    fit = vi.fn()
    proposeDimensions = vi.fn(() => undefined)
  }
  return { FitAddon: FakeFitAddon }
})

// Mocked for the same reason as the two above, and one more: the real
// WebglAddon reaches for a canvas context in its CONSTRUCTOR, so merely
// building one under jsdom prints "Not implemented: HTMLCanvasElement's
// getContext()" over this suite's output. Nothing here is about the renderer —
// tests/pane-gpu-renderer.test.tsx owns that.
vi.mock('@xterm/addon-webgl', () => {
  class FakeWebglAddon {
    onContextLoss = vi.fn()
    dispose = vi.fn()
  }
  return { WebglAddon: FakeWebglAddon }
})

/** Captures the callbacks the component subscribes with `window.bezel.pty.onData`
 *  and `.onExit`, so a test can fire a realistic pty event from outside the tree
 *  — the same "expose the handler" shape tests/app-tabs.test.tsx uses for OSC 7
 *  (`oscHandlers`) and tests/tab-restore.test.tsx's TerminalPane stand-in. */
function stubBridge() {
  let dataCb: ((paneId: string, data: string) => void) | null = null
  let exitCb: ((paneId: string, code: number) => void) | null = null
  const off = () => {}
  window.bezel = {
    ...window.bezel,
    pty: {
      spawn: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn((cb: (paneId: string, data: string) => void) => { dataCb = cb; return off }),
      onExit: vi.fn((cb: (paneId: string, code: number) => void) => { exitCb = cb; return off }),
    },
  } as unknown as typeof window.bezel
  return {
    fireData: (paneId: string, data: string) => dataCb?.(paneId, data),
    fireExit: (paneId: string, code = 0) => exitCb?.(paneId, code),
  }
}

function lastTermText(): string {
  return termInstances.at(-1)!.write.mock.calls.flat().join('')
}

// JSX attribute string literals do NOT interpret JS backslash escapes (they
// are plain, HTML-attribute-like text), so `cwd="C:\\src"` written directly
// in a `<TerminalPane>` tag is two literal backslashes, not one. A single
// constant, passed as an expression, keeps the value used to render and the
// value asserted against unambiguous and consistent.
const CWD = 'C:\\src'

beforeEach(() => {
  termInstances.length = 0
  // jsdom has no ResizeObserver; the component's resize-tracking effect
  // constructs one unconditionally on mount.
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

// This file imports test functions explicitly rather than using vitest's
// globals, so RTL's auto-cleanup never self-registers (see tests/setup.ts's
// own note on the same thing). Without this, a pane from an earlier test
// stays mounted — with its ResizeObserver and pty subscriptions still
// live — while a LATER test advances fake timers, which is exactly the kind
// of cross-test bleed `lastTermText()`'s `.at(-1)` was hiding rather than
// preventing.
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('resuming panes', () => {
  it('shows a resuming notice instead of a blank pane', async () => {
    stubBridge()
    render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'resume', id: 'uuid-a' }} />)
    await vi.waitFor(() => {
      expect(lastTermText()).toContain('resuming session')
    })
  })

  it('reports the assigned id back for a new session', async () => {
    stubBridge()
    const onSessionId = vi.fn()
    ;(window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mockResolvedValue('uuid-fresh')
    render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'new' }} onSessionId={onSessionId} />)
    await vi.waitFor(() => expect(onSessionId).toHaveBeenCalledWith('uuid-fresh'))
  })

  it('treats a silent exit within 5s of a resume as a failed resume', async () => {
    vi.useFakeTimers()
    try {
      const { fireExit } = stubBridge()
      ;(window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mockResolvedValue('uuid-a')
      render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'resume', id: 'uuid-a' }} />)
      // Flush the spawn promise's microtask without advancing real time.
      await vi.advanceTimersByTimeAsync(0)

      // Silence, then a fast exit — well inside the 5000ms window.
      await vi.advanceTimersByTimeAsync(1200)
      fireExit('1:claude')

      expect(lastTermText()).toContain('could not reopen')
      expect(lastTermText()).toContain('fresh')
      // No automatic fresh claude — reviving is deferred to a keystroke, and
      // that keystroke path always spawns `{ mode: 'new' }`, never the dead id.
      expect((window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not call it a failed resume when the pane produced output first', async () => {
    vi.useFakeTimers()
    try {
      const { fireData, fireExit } = stubBridge()
      ;(window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mockResolvedValue('uuid-a')
      render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'resume', id: 'uuid-a' }} />)
      await vi.advanceTimersByTimeAsync(0)

      // Output arrives BEFORE the exit this time.
      fireData('1:claude', 'a banner from the resumed session\r\n')
      await vi.advanceTimersByTimeAsync(1200)
      fireExit('1:claude')

      expect(lastTermText()).toContain('process exited')
      expect(lastTermText()).not.toContain('could not reopen')
    } finally {
      vi.useRealTimers()
    }
  })

  // The other half of "both halves are required": a silent exit that happens
  // to land OUTSIDE the 5000ms window is a real (if fast) session end, not a
  // failed resume — even though nothing was ever printed. Without this test,
  // deleting the `Date.now() - spawnedAt < RESUME_FAILED_MS` clause entirely
  // leaves every other test in this file green, since they all fire their
  // exit at 1200ms.
  it('does not call it a failed resume when the silent exit lands outside the 5s window', async () => {
    vi.useFakeTimers()
    try {
      const { fireExit } = stubBridge()
      ;(window.bezel.pty.spawn as ReturnType<typeof vi.fn>).mockResolvedValue('uuid-a')
      render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'resume', id: 'uuid-a' }} />)
      await vi.advanceTimersByTimeAsync(0)

      // Still silent, but past RESUME_FAILED_MS this time.
      await vi.advanceTimersByTimeAsync(6000)
      fireExit('1:claude')

      expect(lastTermText()).toContain('process exited')
      expect(lastTermText()).not.toContain('could not reopen')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the fresh id after a keystroke revives a failed resume, never the dead one', async () => {
    vi.useFakeTimers()
    const { fireExit } = stubBridge()
    const spawn = window.bezel.pty.spawn as ReturnType<typeof vi.fn>
    spawn.mockResolvedValueOnce('uuid-a') // the initial (doomed) resume
    const onSessionId = vi.fn()
    render(
      <TerminalPane
        id="1:claude"
        cwd={CWD}
        intent={{ mode: 'resume', id: 'uuid-a' }}
        onSessionId={onSessionId}
      />
    )
    await vi.advanceTimersByTimeAsync(0)

    // The resume fails, exactly as in the test above.
    await vi.advanceTimersByTimeAsync(1200)
    fireExit('1:claude')
    expect(lastTermText()).toContain('could not reopen')

    // Back to real timers for the revive: it is driven by ordinary promise
    // resolution (spawn, then resize), not by anything time-based.
    vi.useRealTimers()

    // A keystroke on the now-dead pane revives it. The revive must ask for a
    // FRESH session — never uuid-a — and report back whatever id comes back,
    // so the tab's persisted state stops pointing at the dead one.
    spawn.mockResolvedValueOnce('uuid-fresh')
    const term = termInstances.at(-1)!
    term.keystroke('x')

    await vi.waitFor(() => expect(onSessionId).toHaveBeenCalledWith('uuid-fresh'))
    expect(spawn.mock.calls).toHaveLength(2)
    expect(spawn.mock.calls[1]).toEqual(['1:claude', CWD, { mode: 'new' }])
  })
})

describe('clipboard', () => {
  const lastTerm = () => termInstances[termInstances.length - 1]

  it('copies the selection on ctrl+c and keeps it away from the pty', async () => {
    stubBridge()
    render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'new' }} />)
    await vi.waitFor(() => expect(lastTerm()).toBeTruthy())
    const term = lastTerm()
    term.selection = 'No conversation found with session ID: 81e84288'

    const passedOn = term.press({ key: 'c', ctrlKey: true })

    expect(window.bezel.clipboard.write).toHaveBeenCalledWith('No conversation found with session ID: 81e84288')
    // false tells xterm to stop: the key is ours, and  must not reach the shell.
    expect(passedOn).toBe(false)
  })

  it('still interrupts on ctrl+c when nothing is selected', async () => {
    stubBridge()
    render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'new' }} />)
    await vi.waitFor(() => expect(lastTerm()).toBeTruthy())
    const term = lastTerm()
    term.selection = ''

    const passedOn = term.press({ key: 'c', ctrlKey: true })

    expect(window.bezel.clipboard.write).not.toHaveBeenCalled()
    // true means xterm handles it as usual — which is what sends the interrupt.
    expect(passedOn).toBe(true)
  })

  it('pastes into the pty on ctrl+v', async () => {
    stubBridge()
    ;(window.bezel.clipboard.read as ReturnType<typeof vi.fn>).mockResolvedValue('npm run build')
    render(<TerminalPane id="1:claude" cwd={CWD} intent={{ mode: 'new' }} />)
    await vi.waitFor(() => expect(lastTerm()).toBeTruthy())

    const passedOn = lastTerm().press({ key: 'v', ctrlKey: true })

    await vi.waitFor(() => expect(window.bezel.pty.write).toHaveBeenCalledWith('1:claude', 'npm run build'))
    expect(passedOn).toBe(false)
  })
})
