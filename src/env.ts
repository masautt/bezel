// Environment sanitizing for spawned panes. Pure and browser-safe: takes a
// plain record, returns a plain record. The spawn itself lives in electron/.

// Markers a Claude Code session injects into its own environment. bezel exists
// to LAUNCH Claude, so passing these through is actively harmful: a `claude`
// started from a pane inherits `CLAUDE_CODE_CHILD_SESSION` from whatever
// launched bezel, decides it is a nested child session, and silently stops
// saving transcripts. Observed for real on 2026-08-01 when bezel was started
// from inside a Claude Code session.
const CLAUDE_MARKER = /^CLAUDE(CODE)?(_|$)/

// Set in some parent shells; stops cmd.exe from resolving executables in the
// current directory. Leaking it into a pane breaks any build that shells out to
// a bare relative script name — it is what made node-pty's `GetCommitHash.bat`
// report "not recognized" while sitting in the current directory.
const CWD_EXE_LOOKUP = 'NoDefaultCurrentDirectoryInExePath'

// A parent's opinion about color, which must not become the pane's. These come
// through the same door as the CLAUDE markers above: a Claude Code session sets
// NO_COLOR so the commands it runs return clean, unstyled output. Inherited
// into a pane it silently drains ALL color — Claude Code (via supports-color),
// the prompt's powerline segments, and PowerShell's $PSStyle every one honor
// it — leaving a monochrome pane that otherwise looks perfectly healthy, which
// reads as a font or theme bug rather than an environment one. FORCE_COLOR is
// listed too because FORCE_COLOR=0 suppresses just as thoroughly, and a pane is
// a real terminal that should decide for itself, exactly as TERM below assumes.
//
// Compared uppercased: Windows environment variables are case-insensitive, so a
// parent that set `no_color` would otherwise slip past.
const COLOR_OVERRIDES = new Set(['NO_COLOR', 'FORCE_COLOR'])

// bezel's OWN output, arriving back through the front door. BEZEL_THEME is set
// on every pane this file helps spawn, so launching bezel FROM a bezel pane
// (the ordinary way it gets started during development) hands the new process a
// theme its parent chose. Same class of leak as the CLAUDE markers above.
//
// Harmless in the normal path, where pty-manager overwrites the key right after
// calling this — but only there. With no PaneThemeSource the stale value
// survives into the pane and themes its prompt off a window that may not even
// be open any more, and any future caller inherits the same trap. Stripped here
// so the sanitizer's contract is "no parent opinions", with no exceptions the
// caller has to remember.
const BEZEL_OWN_VARS = new Set(['BEZEL_THEME'])

export type PaneEnv = Record<string, string | undefined>

// Typed as a plain record, not NodeJS.ProcessEnv: src/ is bundled into the
// renderer and deliberately has no Node type definitions available.
export function sanitizePaneEnv(source: PaneEnv): PaneEnv {
  const out: PaneEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (CLAUDE_MARKER.test(key)) continue
    if (key === CWD_EXE_LOOKUP) continue
    if (COLOR_OVERRIDES.has(key.toUpperCase())) continue
    if (BEZEL_OWN_VARS.has(key.toUpperCase())) continue
    out[key] = value
  }
  out.TERM = 'xterm-256color'
  return out
}
