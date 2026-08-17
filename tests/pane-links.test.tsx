import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TerminalPane } from '../client/src/TerminalPane.js'

const CWD = 'C:/Users/testuser/source/orgs/devkit-inc/bezel'

// Same reasoning as tests/pane-gpu-renderer.test.tsx: the REAL TerminalPane is
// rendered, and xterm does nothing meaningful under jsdom. The fake captures the
// three link hooks the pane installs so this suite can fire them directly —
// which is the only way to observe a ctrl+click without a live terminal.
const { termInstances, webLinksHandlers } = vi.hoisted(() => ({
  termInstances: [] as {
    options: Record<string, unknown>
    linkProviders: { provideLinks(y: number, cb: (links: unknown[] | undefined) => void): void }[]
    lineText: string
  }[],
  webLinksHandlers: [] as ((event: MouseEvent, uri: string) => void)[],
}))

vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
    /** What the one buffer line this suite exposes contains. */
    lineText = ''
    linkProviders: unknown[] = []
    write = vi.fn()
    open = vi.fn()
    loadAddon = vi.fn()
    dispose = vi.fn()
    parser = { registerOscHandler: vi.fn() }
    registerLinkProvider = vi.fn((p: unknown) => { this.linkProviders.push(p); return { dispose: () => {} } })
    buffer = {
      active: {
        getLine: () => ({ translateToString: () => this.lineText }),
      },
    }
    onTitleChange() { return { dispose: () => {} } }
    onBell() { return { dispose: () => {} } }
    onData() { return { dispose: () => {} } }
    attachCustomKeyEventHandler = vi.fn()
    hasSelection = () => false
    getSelection = () => ''
    constructor() { termInstances.push(this as never) }
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
  }
  return { WebglAddon: FakeWebglAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class FakeWebLinksAddon {
    constructor(handler: (event: MouseEvent, uri: string) => void) { webLinksHandlers.push(handler) }
    dispose = vi.fn()
  }
  return { WebLinksAddon: FakeWebLinksAddon }
})

function stubBridge() {
  const off = () => {}
  const openExternal = vi.fn().mockResolvedValue(undefined)
  const openFile = vi.fn().mockResolvedValue(true)
  window.bezel = {
    ...window.bezel,
    pty: {
      spawn: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => off,
      onExit: () => off,
    },
    openExternal,
    openFile,
  } as unknown as typeof window.bezel
  return { openExternal, openFile }
}

/** A MouseEvent with only the four facts the activation gate reads. */
function click(overrides: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }> = {}) {
  return {
    ctrlKey: false, shiftKey: false, altKey: false, button: 0, ...overrides,
  } as MouseEvent
}

beforeEach(() => {
  termInstances.length = 0
  webLinksHandlers.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('TerminalPane links', () => {
  it('opens a URL in the OS browser on ctrl+click', () => {
    const { openExternal } = stubBridge()
    render(<TerminalPane id="1:shell" cwd={CWD} intent={{ mode: 'new' }} />)

    webLinksHandlers[0](click({ ctrlKey: true }), 'https://example.com/x')

    expect(openExternal).toHaveBeenCalledWith('https://example.com/x')
  })

  it('leaves a plain click on a URL alone, so selection still works', () => {
    const { openExternal } = stubBridge()
    render(<TerminalPane id="1:shell" cwd={CWD} intent={{ mode: 'new' }} />)

    webLinksHandlers[0](click(), 'https://example.com/x')

    expect(openExternal).not.toHaveBeenCalled()
  })

  it('sends an OSC 8 file:// hyperlink to the editor, not to a browser window', () => {
    const { openFile, openExternal } = stubBridge()
    render(<TerminalPane id="1:shell" cwd={CWD} intent={{ mode: 'new' }} />)

    const handler = termInstances[0].options.linkHandler as {
      activate(e: MouseEvent, t: string): void
    }
    handler.activate(click({ ctrlKey: true }), 'file:///C:/x/foo.ts')

    expect(openFile).toHaveBeenCalledWith({ path: 'C:/x/foo.ts', line: undefined, col: undefined })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens a file path found in pane output, carrying its line number', () => {
    const { openFile } = stubBridge()
    render(<TerminalPane id="1:shell" cwd={CWD} intent={{ mode: 'new' }} />)

    const term = termInstances[0]
    term.lineText = '  at src/links.ts:42:7'
    let links: { activate(e: MouseEvent, t: string): void; text: string }[] = []
    term.linkProviders[0].provideLinks(1, got => { links = (got ?? []) as typeof links })

    expect(links).toHaveLength(1)
    links[0].activate(click({ ctrlKey: true }), links[0].text)

    expect(openFile).toHaveBeenCalledWith({ path: `${CWD}/src/links.ts`, line: 42, col: 7 })
  })
})
