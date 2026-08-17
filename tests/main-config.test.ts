import { describe, it, expect, vi } from 'vitest'
import { patchConfig } from '../electron/config-patch'

// Mirrors BezelConfig in electron/main.ts. Declared explicitly rather than
// inferred from each `read` stub, so a test can patch a key its reader did not
// happen to return — which is the case this whole module exists for.
interface Config {
  lastCwd?: string
  lastRepoRoot?: string
  layout?: unknown
}

describe('patchConfig', () => {
  it('preserves keys it was not given', () => {
    // The whole point: project:remember fires on every shell prompt, and must
    // not erase anything another handler stored.
    const write = vi.fn()
    patchConfig<Config>(() => ({ lastCwd: 'C:/a', lastRepoRoot: 'C:/b' }), write, { lastCwd: 'C:/moved' })
    expect(write).toHaveBeenCalledWith({ lastCwd: 'C:/moved', lastRepoRoot: 'C:/b' })
  })

  it('adds a new key alongside the existing ones', () => {
    const write = vi.fn()
    patchConfig<Config>(() => ({ lastCwd: 'C:/a' }), write, { lastRepoRoot: 'C:/b' })
    expect(write).toHaveBeenCalledWith({ lastCwd: 'C:/a', lastRepoRoot: 'C:/b' })
  })

  it('merges a layout save without disturbing the project keys', () => {
    // The reason patchConfig exists at all: without it, the very next OSC 7
    // from the shell pane would write { lastCwd } alone and erase every saved
    // preset — several times a minute.
    const write = vi.fn()
    const store = { live: {}, presets: [], activeId: 'default' }
    patchConfig<Config>(() => ({ lastCwd: 'C:/a', lastRepoRoot: 'C:/b' }), write, { layout: store })
    expect(write).toHaveBeenCalledWith({ lastCwd: 'C:/a', lastRepoRoot: 'C:/b', layout: store })
  })

  it('a cwd write leaves an existing layout intact', () => {
    const write = vi.fn()
    const store = { live: {}, presets: [], activeId: 'default' }
    patchConfig<Config>(() => ({ layout: store }), write, { lastCwd: 'C:/moved' })
    expect(write).toHaveBeenCalledWith({ layout: store, lastCwd: 'C:/moved' })
  })

  it('writes the patch alone when the file is unreadable', () => {
    // readUserConfig already returns {} on any failure, so this degrades to
    // the pre-fix replace behavior rather than throwing.
    const write = vi.fn()
    patchConfig<Config>(() => ({}), write, { lastCwd: 'C:/a' })
    expect(write).toHaveBeenCalledWith({ lastCwd: 'C:/a' })
  })
})
