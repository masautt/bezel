// Pure keyboard-intent logic for the terminal panes. Zero imports, like
// tabs.ts: this file is compiled by all four tsconfig projects and must not
// pull in DOM or Node types — the caller reads the real KeyboardEvent and hands
// over the four facts that decide the outcome.

/** What a key combination means to the clipboard, if anything. */
export type ClipboardAction = 'copy' | 'paste' | 'passthrough'

export interface KeyFacts {
  /** `KeyboardEvent.key`. Reported uppercase while shift is held. */
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** Whether the terminal currently holds a selection. */
  hasSelection: boolean
}

/**
 * Windows Terminal's bindings, which is the muscle memory a Windows user
 * arrives with:
 *
 *   ctrl+c        copy IF something is selected, otherwise interrupt
 *   ctrl+shift+c  always copy
 *   ctrl+v        paste
 *   ctrl+shift+v  paste
 *
 * The conditional on ctrl+c is the whole design. xterm's default is to send
 * \x03 unconditionally, so copy never worked; but claiming ctrl+c
 * unconditionally would remove the only way to stop a runaway process, which
 * is the worse of the two failures. Selection is what disambiguates, and it is
 * the same rule Windows Terminal settled on.
 */
export function clipboardAction(f: KeyFacts): ClipboardAction {
  // Ctrl+Alt is AltGr on several keyboard layouts, where it types a character.
  // Claiming those combinations would eat real input for non-US layouts.
  if (!f.ctrl || f.alt) return 'passthrough'

  const key = f.key.toLowerCase()
  if (key === 'c') return f.shift || f.hasSelection ? 'copy' : 'passthrough'
  if (key === 'v') return 'paste'
  return 'passthrough'
}
