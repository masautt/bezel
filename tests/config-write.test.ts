import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeJsonAtomic } from '../electron/config-write'

/**
 * `writeUserConfig` does a plain `writeFileSync`, which truncates the file and
 * then writes it. Between those two there is a window — small, but entered
 * several times a minute by `project:remember` — where a crash or a power loss
 * leaves config.json empty or half-written.
 *
 * What is in that file is every layout preset the user has built and the
 * directory the next launch opens at. `readUserConfig` returns `{}` on invalid
 * JSON, so the corruption presents as bezel quietly forgetting everything.
 */

const DIR = mkdtempSync(join(tmpdir(), 'bezel-config-write-'))
afterAll(() => { rmSync(DIR, { recursive: true, force: true }) })

describe('writeJsonAtomic', () => {
  it('writes readable JSON', () => {
    const file = join(DIR, 'fresh.json')
    writeJsonAtomic(file, { lastCwd: 'C:/a' })
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ lastCwd: 'C:/a' })
  })

  it('replaces an existing file', () => {
    const file = join(DIR, 'existing.json')
    writeFileSync(file, JSON.stringify({ lastCwd: 'C:/old', layout: { presets: [1] } }))
    writeJsonAtomic(file, { lastCwd: 'C:/new' })
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ lastCwd: 'C:/new' })
  })

  it('leaves no temp file behind', () => {
    // The temp file lives next to the real one so the rename stays on one
    // volume — a cross-device rename is a copy, which is not atomic and would
    // put the window straight back.
    const dir = mkdtempSync(join(tmpdir(), 'bezel-config-tmp-'))
    writeJsonAtomic(join(dir, 'config.json'), { a: 1 })
    expect(readdirSync(dir)).toEqual(['config.json'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not throw when the directory does not exist', () => {
    // Same contract as writeUserConfig, which swallows everything: a config
    // that cannot be saved is not worth taking the app down for.
    expect(() => writeJsonAtomic(join(DIR, 'no', 'such', 'dir', 'c.json'), { a: 1 })).not.toThrow()
  })

  it('leaves the previous file intact when the write fails', () => {
    // The property that matters: a failed save must lose the NEW value, never
    // the old one. A plain writeFileSync loses both.
    const file = join(DIR, 'survivor.json')
    writeFileSync(file, JSON.stringify({ keep: true }))
    // A value JSON.stringify refuses, so the failure happens before any rename.
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => writeJsonAtomic(file, circular)).not.toThrow()
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ keep: true })
    expect(existsSync(file + '.tmp'), 'no debris from the failed attempt').toBe(false)
  })
})
