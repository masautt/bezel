import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'os'
import { supabaseCredsPath, specsRegistryPath } from '../electron/config-paths'

const VARS = ['BEZEL_CONFIG_DIR', 'BEZEL_SUPABASE_CREDS', 'BEZEL_SPECS_REGISTRY'] as const

afterEach(() => {
  for (const v of VARS) delete process.env[v]
})

// Compared with separators normalized: the paths are built with path.join, so
// they are backslashed on Windows and forward-slashed elsewhere, and asserting
// on the literal would pass on one machine and fail on the other.
const norm = (p: string) => p.replace(/\\/g, '/')

describe('config paths', () => {
  it('defaults to a per-user bezel config directory', () => {
    expect(norm(supabaseCredsPath())).toBe(`${norm(homedir())}/.config/bezel/supabase.json`)
    expect(norm(specsRegistryPath())).toBe(`${norm(homedir())}/.config/bezel/specs-repos.json`)
  })

  it('carries no hardcoded org or deployment name', () => {
    // The point of the indirection: this repo is published, so a default path
    // must not advertise where a service-role key lives.
    for (const p of [supabaseCredsPath(), specsRegistryPath()]) {
      expect(p).not.toMatch(/sbrain|devkit|masautt|orgs/i)
    }
  })

  it('relocates both files together via BEZEL_CONFIG_DIR', () => {
    process.env.BEZEL_CONFIG_DIR = 'D:/secrets'
    expect(norm(supabaseCredsPath())).toBe('D:/secrets/supabase.json')
    expect(norm(specsRegistryPath())).toBe('D:/secrets/specs-repos.json')
  })

  it('lets a specific override win over the directory', () => {
    process.env.BEZEL_CONFIG_DIR = 'D:/secrets'
    process.env.BEZEL_SUPABASE_CREDS = 'D:/elsewhere/creds.json'
    expect(norm(supabaseCredsPath())).toBe('D:/elsewhere/creds.json')
    // The one that was not overridden still follows the directory.
    expect(norm(specsRegistryPath())).toBe('D:/secrets/specs-repos.json')
  })

  it('reads the environment per call, not once at import', () => {
    const before = supabaseCredsPath()
    process.env.BEZEL_SUPABASE_CREDS = 'D:/changed.json'
    expect(supabaseCredsPath()).not.toBe(before)
  })
})
