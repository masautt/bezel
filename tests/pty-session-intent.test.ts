import { describe, it, expect, vi } from 'vitest'
import { createPtyManager } from '../electron/pty-manager.js'

/** A pty that records how it was spawned and does nothing else. */
function fakePty() {
  return { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() }
}

/**
 * Valid-shaped fake uuids: 36 hex-and-dash characters, matching the format
 * pty-manager itself now validates against (see the malformed-id test below).
 * Using real-shaped ids here — rather than the old `'uuid-1'` / `'old-uuid'`
 * placeholders — means these tests exercise the ACCEPT path of that
 * validation, not just its reject path.
 */
function fakeUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}
const OLD_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function harness() {
  const spawns: Array<{ args: string[]; cwd: string }> = []
  const spawnFn = vi.fn((_shell: string, args: string[], opts: { cwd: string }) => {
    spawns.push({ args, cwd: opts.cwd })
    return fakePty()
  })
  let n = 0
  const manager = createPtyManager(spawnFn as never, 'pwsh.exe', undefined, undefined, { newId: () => fakeUuid(++n) })
  return { manager, spawns }
}

const claudeArg = (s: { args: string[] }) => s.args[s.args.length - 1]

describe('session intent', () => {
  it('assigns a fresh session id to a new claude pane and returns it', () => {
    const { manager, spawns } = harness()
    const id = manager.spawn('1:claude', 'C:\\src', { mode: 'new' })
    expect(id).toBe(fakeUuid(1))
    expect(claudeArg(spawns[0])).toContain(`--session-id ${fakeUuid(1)}`)
  })

  it('resumes the named session and never invents one', () => {
    const { manager, spawns } = harness()
    const id = manager.spawn('1:claude', 'C:\\src', { mode: 'resume', id: OLD_UUID })
    expect(id).toBe(OLD_UUID)
    expect(claudeArg(spawns[0])).toContain(`--resume ${OLD_UUID}`)
    expect(claudeArg(spawns[0])).not.toContain('--session-id')
  })

  it('gives the shell pane no session flag at all', () => {
    const { manager, spawns } = harness()
    expect(manager.spawn('1:shell', 'C:\\src', { mode: 'new' })).toBeNull()
    expect(claudeArg(spawns[0])).not.toContain('--session-id')
    expect(claudeArg(spawns[0])).not.toContain('--resume')
  })

  it('a resume never adopts a warm spare', () => {
    const { manager, spawns } = harness()
    vi.useFakeTimers()
    manager.prewarm('C:\\src', 0)
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    const before = spawns.length
    const id = manager.spawn('1:claude', 'C:\\src', { mode: 'resume', id: OLD_UUID })
    expect(id).toBe(OLD_UUID)
    // A spare is a generic pre-booted claude and cannot become your conversation:
    // the resume must have spawned its own pty rather than taken one.
    expect(spawns.length).toBeGreaterThan(before)
    expect(claudeArg(spawns[spawns.length - 1])).toContain(`--resume ${OLD_UUID}`)
  })

  it('a new tab adopts a spare and inherits the uuid that spare booted with', () => {
    const { manager, spawns } = harness()
    vi.useFakeTimers()
    manager.prewarm('C:\\src', 0)
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    // Stops at the trailing `;` from the retry-loop wrapper, not just at
    // whitespace — `\S+` alone would swallow it into the captured id.
    const spareUuid = claudeArg(spawns.find(s => claudeArg(s).includes('--session-id'))!)
      .match(/--session-id ([^\s;]+)/)![1]
    const before = spawns.length
    const id = manager.spawn('1:claude', 'C:\\src', { mode: 'new' })
    expect(id).toBe(spareUuid)
    expect(spawns.length).toBe(before)   // adopted, not spawned
  })

  it('ignores a malformed key without spawning', () => {
    const { manager, spawns } = harness()
    expect(manager.spawn('nonsense', 'C:\\src', { mode: 'new' })).toBeNull()
    expect(spawns).toHaveLength(0)
  })

  it('refuses to interpolate a malformed session id into the command line', () => {
    // intent.id ultimately traces back to a hand-editable config.json (a
    // restored tab's claudeSessionId) by the time Task 5 wires it in. This is
    // the last line of defense before that value is spliced into a live
    // PowerShell command line, so a shell metacharacter must never reach argv.
    const { manager, spawns } = harness()
    const malformed = 'abc; Start-Process calc'
    manager.spawn('1:claude', 'C:\\src', { mode: 'resume', id: malformed })
    expect(claudeArg(spawns[0])).not.toContain('--resume')
    expect(claudeArg(spawns[0])).not.toContain('--session-id')
    expect(claudeArg(spawns[0])).not.toContain('Start-Process calc')
  })
})
