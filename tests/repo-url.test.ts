import { describe, it, expect } from 'vitest'
import { releasesUrl, releaseTagUrl } from '../src/repo-url.js'

describe('releasesUrl', () => {
  // What npm actually writes into a package's `repository.url`.
  it('normalizes the git+https form npm stores', () => {
    expect(releasesUrl('git+https://github.com/devkit-inc/react-ui.git'))
      .toBe('https://github.com/devkit-inc/react-ui/releases')
  })

  it('accepts a plain https url', () => {
    expect(releasesUrl('https://github.com/devkit-inc/electron-ui'))
      .toBe('https://github.com/devkit-inc/electron-ui/releases')
  })

  it('accepts the ssh form', () => {
    expect(releasesUrl('git@github.com:devkit-inc/electron-ui.git'))
      .toBe('https://github.com/devkit-inc/electron-ui/releases')
  })

  // No link at all beats a link that goes somewhere wrong: the About section is
  // where you look when something is already confusing.
  it('returns null for anything it cannot resolve', () => {
    expect(releasesUrl(undefined)).toBeNull()
    expect(releasesUrl('')).toBeNull()
    expect(releasesUrl('not a url')).toBeNull()
    expect(releasesUrl('https://example.com/devkit-inc/react-ui')).toBeNull()
  })
})

describe('releaseTagUrl', () => {
  it('points at the tag for a specific version', () => {
    expect(releaseTagUrl('https://github.com/devkit-inc/bezel', '1.7.0'))
      .toBe('https://github.com/devkit-inc/bezel/releases/tag/v1.7.0')
  })

  it('does not double the v when the version already carries one', () => {
    expect(releaseTagUrl('https://github.com/devkit-inc/bezel', 'v1.7.0'))
      .toBe('https://github.com/devkit-inc/bezel/releases/tag/v1.7.0')
  })

  it('returns null without a resolvable repo or a version', () => {
    expect(releaseTagUrl('not a url', '1.7.0')).toBeNull()
    expect(releaseTagUrl('https://github.com/devkit-inc/bezel', '')).toBeNull()
  })
})
