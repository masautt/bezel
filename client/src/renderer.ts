/**
 * Attaching xterm's GPU renderer, and surviving every way it can refuse.
 *
 * Without this the panes run on xterm's DOM renderer — a `<span>` per style run,
 * per row, per frame — which is the slowest path xterm has and the one paid on
 * every keystroke echo, every scroll, and every frame of Claude's TUI redrawing
 * itself. The WebGL renderer moves that onto the GPU.
 *
 * The addon arrives through an injected factory rather than a `new WebglAddon()`
 * inline, for the same reason pty-manager takes a `SpawnFn`: none of the failure
 * paths below can be reached under jsdom, and a seam is what makes the real code
 * the tested code instead of a parallel one.
 */

/** The slice of `WebglAddon` this module uses. */
export interface RendererAddon {
  onContextLoss(cb: (e: unknown) => void): void
  dispose(): void
}

/**
 * The slice of xterm's `Terminal` this module uses.
 *
 * Generic in the addon type, and that is not decoration: `Terminal.loadAddon`
 * takes `ITerminalAddon`, which requires an `activate` method that
 * `RendererAddon` deliberately does not describe. Pinning this to
 * `RendererAddon` makes a real `Terminal` fail to satisfy the interface in
 * both directions. Parameterised, the addon type flows in from the factory and
 * a host accepting anything WIDER — which is exactly what `Terminal` is —
 * satisfies it.
 */
export interface RendererHost<A> {
  loadAddon(addon: A): void
}

/**
 * Put `term` on the GPU renderer if this machine can, and hand back a disposer
 * that is always safe to call.
 *
 * Every failure here is non-fatal by design: xterm's DOM renderer is the
 * fallback, and a pane that renders slowly is categorically better than one that
 * does not render at all. That covers a machine with no WebGL2 (a blocklisted
 * driver, a remote session), an activation xterm refuses, and a driver that
 * drops the context hours into a session.
 */
// `NoInfer` on the host, so the addon type is decided by the FACTORY alone.
// Without it `term` is an inference site too, and a real `Terminal` offers
// `ITerminalAddon` as a candidate — the two compete, `A` collapses to the
// constraint, and the call fails to typecheck for a reason that has nothing to
// do with the code being wrong.
export function attachGpuRenderer<A extends RendererAddon>(
  term: RendererHost<NoInfer<A>>,
  createAddon: () => A,
): () => void {
  let addon: A | null = null

  // Held in one place so the context-loss handler and the caller's teardown
  // cannot dispose the same addon twice — the handler fires on the driver's
  // clock, which is to say at any point in a pane's life including during its
  // unmount.
  const release = () => {
    if (!addon) return
    const dying = addon
    addon = null
    try {
      dying.dispose()
    } catch {
      // Disposing a renderer whose context is already gone can throw from
      // inside the addon. There is nothing left to clean up at that point and
      // nothing useful to say about it.
    }
  }

  try {
    addon = createAddon()
    // Registered BEFORE loadAddon: activation is what creates the WebGL
    // context, so it is also the earliest moment a loss can be reported.
    //
    // A dropped context leaves a live addon painting nothing — a black pane
    // over a shell that is still running, which reads as a hung terminal.
    // Releasing it hands rendering back to xterm's DOM renderer, and that
    // recovery is the entire reason this handler exists.
    addon.onContextLoss(release)
    term.loadAddon(addon)
  } catch {
    // Either the addon could not be constructed (no WebGL2 — `addon` is still
    // null and there is nothing to release) or xterm refused to activate it,
    // in which case the half-built addon holds a context that must not leak
    // for the life of the pane.
    release()
  }

  return release
}
