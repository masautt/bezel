import { describe, it, expect } from 'vitest'
import { resolveOpenFileAction } from '../electron/open-file-service.js'

const exists = (p: string) => p === 'C:/x/foo.ts'

describe('resolveOpenFileAction', () => {
  it('refuses a path that is not on this box', () => {
    expect(resolveOpenFileAction('C:/x/gone.ts', undefined, undefined, exists)).toEqual({ kind: 'none' })
  })

  it('opens an existing file with no line number', () => {
    expect(resolveOpenFileAction('C:/x/foo.ts', undefined, undefined, exists)).toEqual({
      kind: 'editor',
      args: ['-g', 'C:/x/foo.ts'],
      path: 'C:/x/foo.ts',
    })
  })

  it('appends the line number so the editor lands on it', () => {
    expect(resolveOpenFileAction('C:/x/foo.ts', 42, undefined, exists)).toEqual({
      kind: 'editor',
      args: ['-g', 'C:/x/foo.ts:42'],
      path: 'C:/x/foo.ts',
    })
  })

  it('appends the column when the output supplied one', () => {
    expect(resolveOpenFileAction('C:/x/foo.ts', 42, 7, exists)).toEqual({
      kind: 'editor',
      args: ['-g', 'C:/x/foo.ts:42:7'],
      path: 'C:/x/foo.ts',
    })
  })

  it('ignores a column with no line, which cannot be addressed', () => {
    expect(resolveOpenFileAction('C:/x/foo.ts', undefined, 7, exists)).toEqual({
      kind: 'editor',
      args: ['-g', 'C:/x/foo.ts'],
      path: 'C:/x/foo.ts',
    })
  })
})
