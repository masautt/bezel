import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'

// Same TerminalPane stand-in as app-tabs: xterm does not run under jsdom, but
// the mock must still mount like a real component so "settings never touches a
// pty" stays a meaningful assertion.
const { mounts } = vi.hoisted(() => ({ mounts: [] as string[] }))
vi.mock('../client/src/TerminalPane', () => ({
  TerminalPane: ({ id, cwd }: { id: string; cwd: string }) => {
    useEffect(() => {
      mounts.push(id)
      void window.bezel.pty.spawn(id, cwd, { mode: 'new' })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
    return null
  },
}))

import { App } from '../client/src/App'

const ROOT = 'C:/Users/testuser/source'

function stubBridge() {
  const spawn = vi.fn().mockResolvedValue(undefined)
  const kill = vi.fn().mockResolvedValue(undefined)
  const push = vi.fn().mockResolvedValue(true)
  const tombstone = vi.fn().mockResolvedValue(true)
  const toggleFullscreen = vi.fn()
  const off = () => {}
  window.bezel = {
    ...window.bezel,
    isElectron: true,
    isDev: false,
    minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChange: vi.fn().mockReturnValue(off),
    pty: {
      spawn, kill,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(off),
      onExit: vi.fn().mockReturnValue(off),
    },
    apps: { list: vi.fn().mockResolvedValue([]) },
    git: { info: vi.fn().mockResolvedValue({ branch: null, ahead: 0, dirty: [] }) },
    specs: { list: vi.fn().mockResolvedValue(null), open: vi.fn().mockResolvedValue('local') },
    project: {
      remember: vi.fn().mockResolvedValue(undefined),
      rememberRepo: vi.fn().mockResolvedValue(undefined),
      last: vi.fn().mockResolvedValue({ cwd: ROOT, repoRoot: null }),
    },
    layout: { load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) },
    presets: { pull: vi.fn().mockResolvedValue(null), push, tombstone },
    fullscreen: {
      toggle: toggleFullscreen,
      isFullscreen: vi.fn().mockResolvedValue(false),
      onFullscreenChange: vi.fn().mockReturnValue(off),
    },
    openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.bezel
  return { spawn, kill, push, tombstone, toggleFullscreen }
}

async function openSettings() {
  const bridge = stubBridge()
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'New tab' })
  await user.keyboard('{Control>},{/Control}')
  await screen.findByRole('dialog')
  return { ...bridge, user }
}

// localStorage too: the theme registry persists the selection there, so without
// this the "picks a theme" case below would leave every later test starting on
// GitHub Light rather than on the default.
beforeEach(() => { mounts.length = 0; localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('settings dialog, end to end through App', () => {
  it('opens on Ctrl+, without disturbing a pane', async () => {
    const { spawn, kill } = await openSettings()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(kill).not.toHaveBeenCalled()
  })

  it('opens from the app bar wordmark as well as the shortcut', async () => {
    // Ctrl+, works too, but a keyboard-only affordance is not discoverable —
    // this is the visible way in, and the reason the ⋯ menu could be dropped.
    stubBridge()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'New tab' })

    const brand = screen.getByRole('button', { name: 'bezel settings' })
    // The accessible name LEADS with the visible text, so "click bezel" via
    // speech input still hits it (WCAG 2.5.3) — while "bezel, button" on its own
    // would have said nothing about what the control does.
    expect(brand).toHaveTextContent('bezel')

    await user.click(brand)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('offers no theme control anywhere but settings', async () => {
    // The ⋯ menu carried a Theme row in the title bar. It is gone — `menu` is
    // false — and settings is the only place a theme can be picked.
    stubBridge()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'New tab' })

    expect(screen.queryByTitle('More options')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'bezel settings' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
  })

  it('picks a theme, and the pick lands on the document', async () => {
    // The registry writes the resolved tokens to <html>'s inline style; that is
    // the whole point of driving it rather than the old data-theme-only toggle,
    // whose flips this dialog could not actually paint.
    stubBridge()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'New tab' })

    await user.click(screen.getByRole('button', { name: 'bezel settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))

    const light = screen.getByRole('radio', { name: /GitHub Light/ })
    await user.click(light)

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(light).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.style.getPropertyValue('--ds-bg')).toBeTruthy()
  })

  it('toggles fullscreen on F11, from anywhere in the app', async () => {
    // Wired through App rather than only unit-tested on the hook, because the
    // thing that can silently break is the wiring: nothing in Electron binds
    // F11 for us, and main drops the webContents key listeners wholesale.
    const { toggleFullscreen, user } = await openSettings()
    await user.keyboard('{Escape}')
    await user.keyboard('{F11}')
    expect(toggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('offers the same toggle in Appearance, and names the key', async () => {
    const { toggleFullscreen, user } = await openSettings()
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))

    const button = screen.getByRole('button', { name: /Full screen/ })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'F11')
    await user.click(button)
    expect(toggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('marks every settings section with its own icon', async () => {
    const { user } = await openSettings()
    for (const [label, icon] of [['Layout', 'layout'], ['Appearance', 'appearance'], ['About', 'info']]) {
      expect(screen.getByRole('tab', { name: label }).querySelector(`[data-icon="${icon}"]`)).toBeTruthy()
    }
    // And the icon is decoration, not part of the tab's accessible name.
    await user.click(screen.getByRole('tab', { name: 'About' }))
    expect(screen.getByRole('tab', { name: 'About', selected: true })).toBeInTheDocument()
  })

  it('saves a preset and keeps the dialog open', async () => {
    const { user, push } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Save as…' }))
    await user.type(screen.getByLabelText('New preset name'), 'coding')
    await user.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'coding' })).toBeInTheDocument()
  })

  it('STAYS OPEN when a preset is deleted', async () => {
    // Observed closing in the running app: the click that removes the preset
    // must not also dismiss the dialog, or the user is thrown out of settings
    // every time they delete something.
    const { user, tombstone } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Save as…' }))
    await user.type(screen.getByLabelText('New preset name'), 'coding')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await screen.findByRole('option', { name: 'coding' })

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(tombstone).toHaveBeenCalled())

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // And the built-in default is still there to fall back to.
    expect(screen.getByRole('option', { name: 'default' })).toBeInTheDocument()
  })

  it('never spawns or kills a pty across the whole flow', async () => {
    const { user, spawn, kill } = await openSettings()
    const before = spawn.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Save as…' }))
    await user.type(screen.getByLabelText('New preset name'), 'coding')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.keyboard('{Escape}')

    expect(spawn.mock.calls.length).toBe(before)
    expect(kill).not.toHaveBeenCalled()
    expect(mounts).toHaveLength(2)
  })
})
