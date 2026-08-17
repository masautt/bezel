import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { formatCrash, installCrashHandlers } from '../electron/crash-handlers'

/**
 * Main had no `uncaughtException` or `unhandledRejection` handler, which means
 * anything that throws on that thread exits the app with nothing written
 * anywhere. That is the reason "bezel crashed" was never actionable: there was
 * no way to tell a bad `webContents.send` from a GPU fault after the fact.
 *
 * This does NOT make the app crash-proof. It makes crashes legible.
 */

describe('formatCrash', () => {
  it('leads with the timestamp and the scope', () => {
    const line = formatCrash('uncaughtException', new Error('boom'), '2026-08-12T10:00:00.000Z')
    expect(line).toContain('2026-08-12T10:00:00.000Z')
    expect(line).toContain('uncaughtException')
    expect(line).toContain('boom')
  })

  it('keeps the stack, which is the only thing that locates the fault', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at main (C:/app/electron/main.ts:221:14)'
    expect(formatCrash('uncaughtException', err, '2026-08-12T10:00:00.000Z')).toContain('main.ts:221:14')
  })

  it('handles a rejection that is not an Error', () => {
    // `Promise.reject('nope')` and `reject()` both reach here. A crash log that
    // throws while formatting the crash is the worst possible outcome.
    expect(formatCrash('unhandledRejection', 'nope', '2026-08-12T10:00:00.000Z')).toContain('nope')
    expect(() => formatCrash('unhandledRejection', undefined, '2026-08-12T10:00:00.000Z')).not.toThrow()
  })
})

describe('installCrashHandlers', () => {
  it('logs an uncaught exception rather than letting it exit the app', () => {
    const proc = new EventEmitter()
    const lines: string[] = []
    installCrashHandlers(proc, l => { lines.push(l) })

    // Without a listener, Node's default action for this event is to print and
    // exit. Registering one is what keeps the process alive.
    proc.emit('uncaughtException', new Error('Object has been destroyed'))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Object has been destroyed')
    expect(lines[0]).toContain('uncaughtException')
  })

  it('logs an unhandled rejection', () => {
    const proc = new EventEmitter()
    const lines: string[] = []
    installCrashHandlers(proc, l => { lines.push(l) })

    proc.emit('unhandledRejection', new Error('presets pull failed'))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('unhandledRejection')
    expect(lines[0]).toContain('presets pull failed')
  })

  it('does not escalate when the logger itself fails', () => {
    // The log lives on disk, and a disk that is full or a userData directory
    // that is not writable must not turn a survivable fault into a hard exit.
    const proc = new EventEmitter()
    installCrashHandlers(proc, () => { throw new Error('ENOSPC') })

    expect(() => proc.emit('uncaughtException', new Error('boom'))).not.toThrow()
  })

  it('registers exactly one listener per event', () => {
    // main calls this once, but a double-install would double every log line
    // and make the file useless for counting how often something happens.
    const proc = new EventEmitter()
    installCrashHandlers(proc, vi.fn())

    expect(proc.listenerCount('uncaughtException')).toBe(1)
    expect(proc.listenerCount('unhandledRejection')).toBe(1)
  })
})
