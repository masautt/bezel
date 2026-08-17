import { describe, test, expect, vi } from 'vitest'
import { attachGpuRenderer, type RendererAddon, type RendererHost } from '../client/src/renderer'

/**
 * The GPU renderer is attached through an injected factory rather than
 * `new WebglAddon()` inline, for the same reason pty-manager takes a `SpawnFn`:
 * every path worth having — no WebGL2 at all, an activation xterm refuses, a
 * driver that drops the context mid-session — is a path that CANNOT be reached
 * under jsdom, and a seam is what makes the real code the tested code rather
 * than a parallel one.
 */

function fakeAddon() {
  const lossHandlers: Array<(e: unknown) => void> = []
  return {
    lossHandlers,
    onContextLoss: (cb: (e: unknown) => void) => { lossHandlers.push(cb) },
    dispose: vi.fn(),
  }
}

function fakeTerm() {
  const loaded: RendererAddon[] = []
  return { loaded, loadAddon: (addon: RendererAddon) => { loaded.push(addon) } }
}

describe('attachGpuRenderer', () => {
  test('loads the addon onto the terminal', () => {
    const term = fakeTerm()
    const addon = fakeAddon()

    attachGpuRenderer(term, () => addon)

    expect(term.loaded).toEqual([addon])
  })

  test('the returned disposer disposes the addon', () => {
    const term = fakeTerm()
    const addon = fakeAddon()

    attachGpuRenderer(term, () => addon)()

    expect(addon.dispose).toHaveBeenCalledTimes(1)
  })

  // A machine with no WebGL2 — a blocklisted driver, a remote session — must
  // fall through to xterm's DOM renderer, not lose its terminals. The addon
  // constructor is what throws there.
  test('survives a factory that throws, leaving the DOM renderer in place', () => {
    const term = fakeTerm()

    const dispose = attachGpuRenderer(term, () => { throw new Error('WebGL2 not supported') })

    expect(term.loaded).toEqual([])
    expect(() => dispose()).not.toThrow()
  })

  // The other half of the same failure: the addon constructs, and xterm
  // rejects it during activation. The half-built addon has to be released, or
  // its context leaks for the life of the pane.
  test('disposes the addon when the terminal refuses to load it', () => {
    const addon = fakeAddon()
    const term: RendererHost<RendererAddon> = { loadAddon: () => { throw new Error('could not activate') } }

    const dispose = attachGpuRenderer(term, () => addon)

    expect(addon.dispose).toHaveBeenCalledTimes(1)
    expect(() => dispose()).not.toThrow()
  })

  // A dropped GPU context leaves a live addon painting nothing — a black pane
  // over a shell that is still running. Disposing it hands rendering back to
  // xterm's DOM renderer, which is the whole recovery.
  test('disposes the addon on context loss, and stays safe to dispose after', () => {
    const term = fakeTerm()
    const addon = fakeAddon()

    const dispose = attachGpuRenderer(term, () => addon)
    addon.lossHandlers.forEach(cb => cb({}))

    expect(addon.dispose).toHaveBeenCalledTimes(1)
    dispose()
    expect(addon.dispose).toHaveBeenCalledTimes(1)
  })
})
