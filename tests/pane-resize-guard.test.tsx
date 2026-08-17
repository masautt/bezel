import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TerminalPane } from '../client/src/TerminalPane.js'

/**
 * The pty must never be told a size the pane does not have.
 *
 * TerminalPane re-measures on every ResizeObserver callback and forwards the
 * result to the shell behind it. A pane with no box on screen measures as zero,
 * and a live conpty reshaped to 0x0 while its process keeps writing is a broken
 * terminal, not a slow one. See src/pane-size.ts.
 */
const { fitAddons } = vi.hoisted(() => ({
  fitAddons: [] as { proposeDimensions: ReturnType<typeof import('vitest').vi.fn>; fit: ReturnType<typeof import('vitest').vi.fn> }[],
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
    onTitleChange() { return { dispose: () => {} } }
    onBell() { return { dispose: () => {} } }
    onData() { return { dispose: () => {} } }
    attachCustomKeyEventHandler = vi.fn()
    hasSelection = () => false
    getSelection = () => ''
  }
  return { Terminal: FakeTerminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon {
    fit = vi.fn()
    // Overwritten per test; the default stands in for "cannot measure".
    proposeDimensions = vi.fn(() => undefined as unknown)
    constructor() { fitAddons.push(this as never) }
  }
  return { FitAddon: FakeFitAddon }
})

vi.mock('@xterm/addon-webgl', () => {
  class FakeWebglAddon {
    onContextLoss = vi.fn()
    dispose = vi.fn()
  }
  return { WebglAddon: FakeWebglAddon }
})

/** Captures the ResizeObserver callback so a test can fire a real one. */
const { observers } = vi.hoisted(() => ({ observers: [] as (() => void)[] }))

function stubBridge() {
  const off = () => {}
  window.bezel = {
    ...window.bezel,
    pty: {
      spawn: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn(() => off),
      onExit: vi.fn(() => off),
    },
  } as unknown as typeof window.bezel
}

const settle = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Longer than TerminalPane's 100ms resize debounce. */
const AFTER_DEBOUNCE = 200

beforeEach(() => {
  fitAddons.length = 0
  observers.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(cb: () => void) { observers.push(cb) }
    observe() {}
    disconnect() {}
  }
  stubBridge()
})

afterEach(() => { cleanup() })

describe('TerminalPane resize guard', () => {
  it('forwards a real measurement to the pty', async () => {
    render(<TerminalPane id="1:shell" cwd="C:\\src" intent={{ mode: 'new' }} />)
    const fit = fitAddons.at(-1)!
    fit.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 })
    ;(window.bezel.pty.resize as ReturnType<typeof vi.fn>).mockClear()

    observers.at(-1)!()
    await settle(AFTER_DEBOUNCE)

    expect(window.bezel.pty.resize).toHaveBeenCalledWith('1:shell', 100, 30)
    expect(fit.fit).toHaveBeenCalled()
  })

  // The hidden-pane case. A collapsed box must not reach the shell at all.
  it('never resizes the pty to a collapsed box', async () => {
    render(<TerminalPane id="1:shell" cwd="C:\\src" intent={{ mode: 'new' }} />)
    const fit = fitAddons.at(-1)!
    fit.proposeDimensions.mockReturnValue({ cols: 0, rows: 0 })
    ;(window.bezel.pty.resize as ReturnType<typeof vi.fn>).mockClear()
    fit.fit.mockClear()

    observers.at(-1)!()
    await settle(AFTER_DEBOUNCE)

    expect(window.bezel.pty.resize).not.toHaveBeenCalled()
    // Fitting to a collapsed box would reshape the terminal's own geometry too.
    expect(fit.fit).not.toHaveBeenCalled()
  })

  it('never resizes the pty to a measurement that is not a number', async () => {
    render(<TerminalPane id="1:shell" cwd="C:\\src" intent={{ mode: 'new' }} />)
    const fit = fitAddons.at(-1)!
    fit.proposeDimensions.mockReturnValue({ cols: Number.NaN, rows: 24 })
    ;(window.bezel.pty.resize as ReturnType<typeof vi.fn>).mockClear()

    observers.at(-1)!()
    await settle(AFTER_DEBOUNCE)

    expect(window.bezel.pty.resize).not.toHaveBeenCalled()
  })
})
