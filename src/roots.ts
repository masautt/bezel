import { normalizePath } from './paths.js'

/**
 * The three directories bezel resolves everything against. One fact, derived
 * once, instead of the same `C:/Users/<name>/source/orgs` literal compiled into
 * main, the preload and two renderer components.
 */
export interface Roots {
  /** The user's home directory, normalized. Only `abbreviateHome` needs it. */
  home: string
  /** Where bezel opens a fresh tab, and the launch fallback. */
  sourceRoot: string
  /** The root every org/repo resolution walks down from. */
  orgsRoot: string
}

/**
 * `~/source/orgs` is not a guess: it is what `layout.json`'s `source_root`
 * declares in `orgs/masautt-inc/config`, which is the source of truth for how
 * these machines are laid out.
 *
 * It is DERIVED from the home directory rather than READ from that file on
 * purpose. Reading it would make bezel fail to launch on a box where the config
 * repo happens not to be cloned — a runtime dependency on another repo, to
 * learn a value this one can compute. The layout is a convention bezel follows,
 * not a service it calls.
 *
 * Pure and browser-safe (no `os`, no `process`), because `src/` is bundled into
 * the renderer as well as compiled for main. The caller supplies `home`.
 */
export function deriveRoots(home: string): Roots {
  const base = normalizePath(home)
  const sourceRoot = `${base}/source`
  return { home: base, sourceRoot, orgsRoot: `${sourceRoot}/orgs` }
}
