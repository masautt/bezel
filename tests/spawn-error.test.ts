import { describe, it, expect } from 'vitest'
import { formatSpawnError } from '@shared/spawn-error'

describe('formatSpawnError', () => {
  it('strips the Electron remote-method prefix and the Error label', () => {
    const err = new Error("Error invoking remote method 'pty:spawn': Error: spawn pwsh.exe ENOENT")
    expect(formatSpawnError(err)).toBe('spawn pwsh.exe ENOENT')
  })

  it('drops the appended main-process stack', () => {
    const err = new Error(
      "Error invoking remote method 'pty:spawn': Error: spawn pwsh.exe ENOENT\n" +
        '    at IpcMainImpl.<anonymous> (C:\\app\\electron\\main.ts:177:5)\n' +
        '    at IpcMainImpl.emit (node:events:518:28)'
    )
    expect(formatSpawnError(err)).toBe('spawn pwsh.exe ENOENT')
  })

  it('never returns a multi-line string', () => {
    // Load-bearing: this goes straight into xterm, where a bare \n moves down a
    // row without returning the cursor and desyncs every frame drawn after it.
    const err = new Error('line one\nline two\r\nline three')
    expect(formatSpawnError(err)).not.toMatch(/[\r\n]/)
  })

  it('handles rejections that are not Errors', () => {
    expect(formatSpawnError('plain string')).toBe('plain string')
    expect(formatSpawnError({ code: 'ENOENT' })).toBe('[object Object]')
  })

  it('falls back to a readable label when there is no message', () => {
    // `reject()` and `new Error('')` would otherwise render as
    // "[failed to start: ]", which reads as a bug in the pane, not the spawn.
    expect(formatSpawnError(new Error(''))).toBe('unknown error')
    expect(formatSpawnError(undefined)).toBe('undefined')
  })
})
