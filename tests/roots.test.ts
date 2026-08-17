import { describe, it, expect } from 'vitest'
import { deriveRoots } from '@shared/roots'

describe('deriveRoots', () => {
  it('derives the source and orgs roots from a home directory', () => {
    expect(deriveRoots('C:/Users/testuser')).toEqual({
      home: 'C:/Users/testuser',
      sourceRoot: 'C:/Users/testuser/source',
      orgsRoot: 'C:/Users/testuser/source/orgs',
    })
  })

  // os.homedir() returns backslashes on Windows, and every path this app compares
  // against is normalized — a raw homedir would fail every startsWith check.
  it('normalizes what os.homedir() actually hands back on Windows', () => {
    expect(deriveRoots('C:\\Users\\testuser').orgsRoot).toBe('C:/Users/testuser/source/orgs')
  })

  it('upper-cases the drive letter, like every other path in the app', () => {
    expect(deriveRoots('c:/Users/testuser').orgsRoot).toBe('C:/Users/testuser/source/orgs')
  })

  // The whole point: no username is baked in anywhere.
  it('works for any user, not just the one this repo was written on', () => {
    expect(deriveRoots('/home/someone').orgsRoot).toBe('/home/someone/source/orgs')
    expect(deriveRoots('C:/Users/other').sourceRoot).toBe('C:/Users/other/source')
  })
})
