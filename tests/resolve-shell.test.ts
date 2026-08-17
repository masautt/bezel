import { describe, it, expect } from 'vitest'
import path from 'path'
import { mkdtempSync, writeFileSync, existsSync, lstatSync } from 'fs'
import { tmpdir } from 'os'
import { resolvePwshOnPath, pwshProbe } from '../electron/resolve-shell'

const PATH_OF = (...dirs: string[]) => dirs.join(path.delimiter)

// The Store/MSIX build of PowerShell 7 puts nothing on PATH except an App
// Execution Alias stub here — a zero-byte APPEXECLINK reparse point.
const WINDOWS_APPS = 'C:\\Users\\testuser\\AppData\\Local\\Microsoft\\WindowsApps'
const MSI = 'C:\\Program Files\\PowerShell\\7'
const SYSTEM32 = 'C:\\WINDOWS\\System32'

/** What `existsSync` sees: it stats, so it tries to follow the APPEXECLINK,
 *  gets EACCES, and reports false for a pwsh that spawns perfectly well. */
const existsSyncView = (candidate: string) =>
  candidate === path.join(MSI, 'pwsh.exe')

/** What `lstat` sees: it does not follow the link, so the alias is visible. */
const lstatView = (candidate: string) =>
  candidate === path.join(MSI, 'pwsh.exe') || candidate === path.join(WINDOWS_APPS, 'pwsh.exe')

describe('resolvePwshOnPath', () => {
  it('finds an ordinary pwsh.exe on PATH', () => {
    const found = resolvePwshOnPath(PATH_OF(SYSTEM32, MSI), lstatView)
    expect(found).toBe(path.join(MSI, 'pwsh.exe'))
  })

  it('returns the FIRST match, mirroring what spawning bare pwsh.exe would pick', () => {
    const found = resolvePwshOnPath(PATH_OF(WINDOWS_APPS, MSI), lstatView)
    expect(found).toBe(path.join(WINDOWS_APPS, 'pwsh.exe'))
  })

  it('returns null when pwsh really is absent', () => {
    expect(resolvePwshOnPath(PATH_OF(SYSTEM32), lstatView)).toBeNull()
  })

  it('finds a Store/MSIX pwsh that existsSync cannot see', () => {
    // The regression this module exists for. With pwsh installed from the
    // Store the alias stub is the ONLY pwsh on PATH, and the old existsSync
    // probe reported "no pwsh" — demoting bezel to Windows PowerShell, where
    // the user's `csource` profile function does not exist.
    const realPath = PATH_OF(SYSTEM32, WINDOWS_APPS)
    expect(resolvePwshOnPath(realPath, existsSyncView)).toBeNull()
    expect(resolvePwshOnPath(realPath, lstatView)).toBe(path.join(WINDOWS_APPS, 'pwsh.exe'))
  })

  it('skips empty PATH entries instead of probing the cwd', () => {
    // A stray delimiter would otherwise join to a bare relative "pwsh.exe".
    const probed: string[] = []
    resolvePwshOnPath(PATH_OF('', SYSTEM32, ''), c => {
      probed.push(c)
      return false
    })
    expect(probed).toEqual([path.join(SYSTEM32, 'pwsh.exe')])
  })

  it('treats an unset PATH as no pwsh rather than throwing', () => {
    expect(resolvePwshOnPath(undefined, lstatView)).toBeNull()
  })
})

describe('pwshProbe', () => {
  it('is true for a real file and false for a missing one', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bezel-probe-'))
    const real = path.join(dir, 'pwsh.exe')
    writeFileSync(real, '')
    expect(pwshProbe(real)).toBe(true)
    expect(pwshProbe(path.join(dir, 'nope.exe'))).toBe(false)
  })

  it.runIf(process.platform === 'win32')('is true for the MSIX alias stub when one is installed', () => {
    // Environment-dependent by nature: only meaningful on a box where pwsh was
    // installed from the Store. Skipped rather than failed elsewhere, since a
    // machine with the MSI build has no stub to probe.
    const stub = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'pwsh.exe')
    let isAlias = false
    try {
      isAlias = !existsSync(stub) && lstatSync(stub) != null
    } catch {
      isAlias = false
    }
    if (!isAlias) return
    expect(pwshProbe(stub)).toBe(true)
  })
})
