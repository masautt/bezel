import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TerminalPane } from '../client/src/TerminalPane.js'

// Same reasoning as tests/pane-resume.test.tsx: this suite renders the REAL
// TerminalPane, and neither xterm's `Terminal` nor its addons do anything
// meaningful under jsdom. Mocked to just enough to observe what the component
// wires up — here, that the pane leaves the DOM renderer behind and releases
// the GPU one when it unmounts.
const { termInstances, webglInstances } = vi.hoisted(() => ({
  termInstances: [] as { calls: string[]; addons: unknown[] }[],
  webglInstances: [] as { dispose: ReturnType<typeof import('vitest').vi.fn> }[],
}))

vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
    /** Ordered record of the lifecycle calls this suite asserts against. */
    calls: string[] = []
    addons: unknown[] = []
    write = vi.fn()
    open = vi.fn(() => { this.calls.push('open') })
    loadAddon = vi.fn((addon: unknown) => { this.calls.push('loadAddon'); this.addons.push(addon) })
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

vi.mock('@xterm/addon-webgl', () => {
  class FakeWebglAddon {
    onContextLoss = vi.fn()
    dispose = vi.fn()
    constructor() { webglInstances.push(this) }
  }
  return { WebglAddon: FakeWebglAddon }
})

function stubBridge() {
  const off = () => {}
  window.bezel = {
    ...window.bezel,
    pty: {
      spawn: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn(() => off),
      onExit: vi.fn(() => off),
    },
  } as unknown as typeof window.bezel
}

beforeEach(() => {
  termInstances.length = 0
  webglInstances.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  stubBridge()
})

afterEach(() => { cleanup() })

describe('TerminalPane GPU renderer', () => {
  it('puts the pane on the WebGL renderer', () => {
    render(<TerminalPane id="1:shell" cwd="C:\\src" intent={{ mode: 'new' }} />)

    expect(webglInstances).toHaveLength(1)
    expect(termInstances.at(-1)!.addons).toContain(webglInstances[0])
  })

  // WebglAddon builds its GL context during activation, which needs a terminal
  // that is already attached to an element. Loading it before `open()` throws,
  // and the pane would silently fall back to the DOM renderer this whole change
  // exists to get off.
  it('loads the renderer only after the terminal is open', () => {
    render(<TerminalPane id="1:shell" cwd="C:\\src" intent={{ mode: 'new' }} />)

    const { calls } = termInstances.at(-1)!
    expect(calls.indexOf('open')).toBeLessThan(calls.lastIndexOf('loadAddon'))
  })

  // Every tab holds two of these and they are disposed and rebuilt as tabs come
  // and go. A GL context that outlives its pane is a leak the user pays for in
  // GPU memory for the rest of the session.
  it('releases the renderer when the pane unmounts', () => {
    const view = render(<TerminalPane id="1:shell" cwd="C:\\src" intent={{ mode: 'new' }} />)

    expect(webglInstances[0].dispose).not.toHaveBeenCalled()
    view.unmount()

    expect(webglInstances[0].dispose).toHaveBeenCalledTimes(1)
  })
})
