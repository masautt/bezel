import { describe, it, expect } from 'vitest'
import { parseOsc7 } from '@shared/osc7'

describe('parseOsc7', () => {
  it('extracts a Windows path from a file URL', () => {
    expect(parseOsc7('file:///C:/Users/testuser/source')).toBe('C:/Users/testuser/source')
  })

  it('accepts a hostname between the slashes', () => {
    expect(parseOsc7('file://desktop-pc/C:/Users/testuser/source')).toBe('C:/Users/testuser/source')
  })

  it('percent-decodes spaces', () => {
    expect(parseOsc7('file:///C:/Users/testuser/My%20Docs')).toBe('C:/Users/testuser/My Docs')
  })

  it('percent-decodes other escaped characters', () => {
    expect(parseOsc7('file:///C:/tmp/a%23b')).toBe('C:/tmp/a#b')
  })

  it('normalizes backslashes', () => {
    expect(parseOsc7('file:///C:\\Users\\testuser')).toBe('C:/Users/testuser')
  })

  it('returns null for a non-file scheme', () => {
    expect(parseOsc7('http://example.com/x')).toBeNull()
  })

  it('returns null for a truncated payload', () => {
    expect(parseOsc7('file://')).toBeNull()
  })

  it('returns null for an empty payload', () => {
    expect(parseOsc7('')).toBeNull()
  })

  it('returns null rather than throwing on a malformed percent escape', () => {
    expect(parseOsc7('file:///C:/tmp/%ZZ')).toBeNull()
  })

  it('returns null for a degenerate payload that normalizes to empty', () => {
    expect(parseOsc7('file:////')).toBeNull()
  })
})
