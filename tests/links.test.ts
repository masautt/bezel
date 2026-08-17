import { describe, it, expect } from 'vitest'
import { classifyLinkTarget, findFilePaths, isLinkActivation } from '@shared/links'

const CWD = 'C:/Users/testuser/source/orgs/devkit-inc/bezel'

describe('classifyLinkTarget — URLs', () => {
  it('accepts an https URL', () => {
    expect(classifyLinkTarget('https://example.com/x', CWD)).toEqual({
      kind: 'url',
      url: 'https://example.com/x',
    })
  })

  it('accepts a localhost dev-server URL with a port', () => {
    expect(classifyLinkTarget('http://localhost:5173', CWD)).toEqual({
      kind: 'url',
      url: 'http://localhost:5173',
    })
  })

  it('rejects a scheme the main-process guard would refuse', () => {
    expect(classifyLinkTarget('ftp://example.com/x', CWD)).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(classifyLinkTarget('', CWD)).toBeNull()
  })
})

describe('classifyLinkTarget — file paths', () => {
  it('unwraps a file:// URL, which OSC 8 emitters use for local files', () => {
    expect(classifyLinkTarget('file:///C:/x/y.ts', CWD)).toEqual({
      kind: 'file',
      path: 'C:/x/y.ts',
    })
  })

  it('normalizes an absolute Windows path', () => {
    expect(classifyLinkTarget('C:\\Users\\testuser\\foo.ts', CWD)).toEqual({
      kind: 'file',
      path: 'C:/Users/testuser/foo.ts',
    })
  })

  it('accepts an absolute POSIX path', () => {
    expect(classifyLinkTarget('/usr/local/bin/thing', CWD)).toEqual({
      kind: 'file',
      path: '/usr/local/bin/thing',
    })
  })

  it('reads a line number without mistaking the drive colon for one', () => {
    expect(classifyLinkTarget('C:/x/foo.ts:42', CWD)).toEqual({
      kind: 'file',
      path: 'C:/x/foo.ts',
      line: 42,
    })
  })

  it('reads a line and column suffix', () => {
    expect(classifyLinkTarget('C:/x/foo.ts:42:7', CWD)).toEqual({
      kind: 'file',
      path: 'C:/x/foo.ts',
      line: 42,
      col: 7,
    })
  })

  it('resolves a ./-relative path against the pane cwd', () => {
    expect(classifyLinkTarget('./src/links.ts', CWD)).toEqual({
      kind: 'file',
      path: `${CWD}/src/links.ts`,
    })
  })

  it('resolves a bare relative path against the pane cwd', () => {
    expect(classifyLinkTarget('src/links.ts:10', CWD)).toEqual({
      kind: 'file',
      path: `${CWD}/src/links.ts`,
      line: 10,
    })
  })

  it('rejects prose, which contains spaces', () => {
    expect(classifyLinkTarget('just some words', CWD)).toBeNull()
  })

  it('rejects a bare word with no separator', () => {
    expect(classifyLinkTarget('README', CWD)).toBeNull()
  })
})

describe('findFilePaths', () => {
  it('locates a path with a line number inside a sentence', () => {
    const line = 'see src/links.ts:10 for details'
    expect(findFilePaths(line, CWD)).toEqual([
      {
        start: 4,
        end: 19,
        target: { kind: 'file', path: `${CWD}/src/links.ts`, line: 10 },
      },
    ])
  })

  it('leaves a sentence-ending period out of the path', () => {
    const [match] = findFilePaths('edited src/links.ts.', CWD)
    expect(match.target).toEqual({ kind: 'file', path: `${CWD}/src/links.ts` })
    expect(match.end).toBe(19)
  })

  it('ignores URLs, which the web-links addon already decorates', () => {
    expect(findFilePaths('visit https://example.com/a/b now', CWD)).toEqual([])
  })

  it('finds every path on the line', () => {
    const matches = findFilePaths('cp ./a/one.ts C:/tmp/two.ts', CWD)
    expect(matches.map(m => m.target)).toEqual([
      { kind: 'file', path: `${CWD}/a/one.ts` },
      { kind: 'file', path: 'C:/tmp/two.ts' },
    ])
  })

  it('finds nothing in prose', () => {
    expect(findFilePaths('all tests passed with no errors', CWD)).toEqual([])
  })
})

describe('isLinkActivation', () => {
  const click = { ctrl: false, shift: false, alt: false, button: 0 }

  it('opens on ctrl+left click, matching VS Code and Windows Terminal', () => {
    expect(isLinkActivation({ ...click, ctrl: true })).toBe(true)
  })

  it('leaves a plain click to place the cursor', () => {
    expect(isLinkActivation(click)).toBe(false)
  })

  it('leaves ctrl+shift+click to extend the selection', () => {
    expect(isLinkActivation({ ...click, ctrl: true, shift: true })).toBe(false)
  })

  it('ignores a ctrl+right click, which belongs to the context menu', () => {
    expect(isLinkActivation({ ...click, ctrl: true, button: 2 })).toBe(false)
  })
})
