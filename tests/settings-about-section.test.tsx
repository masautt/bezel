import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutSection } from '../client/src/settings/sections/AboutSection.js'

const ROOTS = {
  home: 'C:/Users/tester',
  sourceRoot: 'C:/Users/tester/source',
  orgsRoot: 'C:/Users/tester/source/orgs',
}

function stubBridge() {
  const openExternal = vi.fn().mockResolvedValue(undefined)
  window.bezel = { ...window.bezel, roots: ROOTS, openExternal } as unknown as typeof window.bezel
  return { openExternal }
}

beforeEach(() => {
  vi.stubGlobal('__INTERNAL_DEPS__', [
    { name: '@devkit-inc/electron-ui', version: '2.6.0', repository: 'git+https://github.com/devkit-inc/electron-ui.git' },
    { name: '@devkit-inc/react-ui', version: '1.21.0', repository: 'git+https://github.com/devkit-inc/react-ui.git' },
  ])
  vi.stubGlobal('__APP_REPOSITORY__', 'git+https://github.com/devkit-inc/bezel.git')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AboutSection', () => {
  it('lists the internal packages bezel is running, with their resolved versions', () => {
    stubBridge()
    render(<AboutSection version="1.7.0" />)
    expect(screen.getByText('@devkit-inc/electron-ui')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2.6.0' })).toBeInTheDocument()
    expect(screen.getByText('@devkit-inc/react-ui')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1.21.0' })).toBeInTheDocument()
  })

  it('opens the release for bezel’s own version', async () => {
    const { openExternal } = stubBridge()
    const user = userEvent.setup()
    render(<AboutSection version="1.7.0" />)

    await user.click(screen.getByRole('button', { name: '1.7.0' }))

    expect(openExternal).toHaveBeenCalledWith('https://github.com/devkit-inc/bezel/releases/tag/v1.7.0')
  })

  // The list, not a tag: the internal packages are not tagged for every
  // published version, so a per-version link would 404.
  it('opens the releases list for an internal package', async () => {
    const { openExternal } = stubBridge()
    const user = userEvent.setup()
    render(<AboutSection version="1.7.0" />)

    await user.click(screen.getByRole('button', { name: '2.6.0' }))

    expect(openExternal).toHaveBeenCalledWith('https://github.com/devkit-inc/electron-ui/releases')
  })

  // Load-bearing, and the reason these are buttons rather than anchors: a real
  // navigation in this renderer fires did-start-navigation, which bezel wires
  // to killAll — clicking a link would kill every pty in every tab.
  it('never renders a navigable link', () => {
    stubBridge()
    const { container } = render(<AboutSection version="1.7.0" />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('renders a version as plain text when its repo cannot be resolved', () => {
    stubBridge()
    vi.stubGlobal('__INTERNAL_DEPS__', [
      { name: '@devkit-inc/mystery', version: '9.9.9', repository: undefined },
    ])
    render(<AboutSection version="1.7.0" />)
    expect(screen.getByText('9.9.9')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '9.9.9' })).toBeNull()
  })

  it('still shows the paths it always showed', () => {
    stubBridge()
    render(<AboutSection version="1.7.0" />)
    expect(screen.getByText(ROOTS.sourceRoot)).toBeInTheDocument()
    expect(screen.getByText(ROOTS.orgsRoot)).toBeInTheDocument()
  })
})
