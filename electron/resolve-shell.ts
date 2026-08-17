import path from 'path'
import { lstatSync } from 'fs'

/**
 * Find `pwsh.exe` (PowerShell 7) on PATH, or null if it genuinely is not there.
 *
 * Probe the same thing that actually gets spawned: bare `pwsh.exe` resolved off
 * PATH, not a hardcoded install path — a pwsh installed via winget/scoop/MSIX
 * lands on PATH without ever touching `C:/Program Files/PowerShell/7`, and
 * probing the wrong location silently downgrades a perfectly good pwsh install
 * to Windows PowerShell.
 *
 * `probe` is injected so this stays testable without a real filesystem.
 */
export function resolvePwshOnPath(
  pathVar: string | undefined,
  probe: (candidate: string) => boolean
): string | null {
  const dirs = (pathVar ?? '').split(path.delimiter)
  for (const dir of dirs) {
    // An empty PATH entry (a stray `;`) would join to a bare relative
    // "pwsh.exe" and probe the process cwd — never what was meant.
    if (!dir) continue
    const candidate = path.join(dir, 'pwsh.exe')
    if (probe(candidate)) return candidate
  }
  return null
}

/**
 * The real probe. `lstat`, NOT `existsSync`.
 *
 * When PowerShell 7 is installed as the Store/MSIX package, the only thing it
 * puts on PATH is an App Execution Alias stub at
 * `%LOCALAPPDATA%/Microsoft/WindowsApps/pwsh.exe`: a zero-byte file whose
 * content lives in an APPEXECLINK reparse point. `existsSync` — which stats,
 * and so tries to follow that reparse point — gets EACCES and reports **false**
 * for a pwsh that spawns perfectly well. That is not hypothetical: it is what
 * demoted this machine to Windows PowerShell, where `csource` is undefined,
 * the moment pwsh went from the MSI to the Store build.
 *
 * `lstat` does not follow the link, so it succeeds on the alias stub and on an
 * ordinary `pwsh.exe` alike — strictly more permissive than `existsSync`, and
 * false only when nothing is there at all.
 */
export function pwshProbe(candidate: string): boolean {
  try {
    lstatSync(candidate)
    return true
  } catch {
    return false
  }
}
