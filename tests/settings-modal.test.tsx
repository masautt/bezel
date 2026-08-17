import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsModal, type SettingsSection } from '../client/src/settings/SettingsModal'

const SECTIONS: SettingsSection[] = [
  { id: 'one', label: 'One', render: () => <div>panel one</div> },
  { id: 'two', label: 'Two', render: () => <div><button>in-two</button>panel two</div> },
]

describe('SettingsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SettingsModal open={false} sections={SECTIONS} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the first section by default and swaps on click', async () => {
    render(<SettingsModal open sections={SECTIONS} onClose={vi.fn()} />)
    expect(screen.getByText('panel one')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }))
    expect(screen.getByText('panel two')).toBeInTheDocument()
    expect(screen.queryByText('panel one')).toBeNull()
  })

  it('only renders the visible section, so a hidden one cannot fetch', () => {
    const two = vi.fn(() => <div>panel two</div>)
    render(<SettingsModal open sections={[SECTIONS[0], { id: 'two', label: 'Two', render: two }]} onClose={vi.fn()} />)
    expect(two).not.toHaveBeenCalled()
  })

  it('closes on Escape, on the backdrop, and on the close button', async () => {
    const onClose = vi.fn()
    render(<SettingsModal open sections={SECTIONS} onClose={onClose} />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('settings-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)

    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('does not close on a click inside the panel', async () => {
    const onClose = vi.fn()
    render(<SettingsModal open sections={SECTIONS} onClose={onClose} />)
    await userEvent.click(screen.getByText('panel one'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus into the dialog on open', async () => {
    render(<SettingsModal open sections={SECTIONS} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement))
  })

  it('returns focus to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { rerender } = render(<SettingsModal open sections={SECTIONS} onClose={vi.fn()} />)
    rerender(<SettingsModal open={false} sections={SECTIONS} onClose={vi.fn()} />)
    // Without this the next keystroke goes nowhere — a pane almost certainly
    // had focus before the dialog opened.
    await waitFor(() => expect(document.activeElement).toBe(opener))
    opener.remove()
  })

  it('traps Tab inside the dialog', async () => {
    // A Tab that escapes lands in a terminal pane, which forwards keystrokes to
    // a live pty — typing into a shell the user cannot see.
    render(<SettingsModal open sections={SECTIONS} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    for (let i = 0; i < 12; i += 1) await userEvent.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('reopens on the first section rather than where it was left', async () => {
    const { rerender } = render(<SettingsModal open sections={SECTIONS} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }))
    expect(screen.getByText('panel two')).toBeInTheDocument()

    rerender(<SettingsModal open={false} sections={SECTIONS} onClose={vi.fn()} />)
    rerender(<SettingsModal open sections={SECTIONS} onClose={vi.fn()} />)
    expect(screen.getByText('panel one')).toBeInTheDocument()
  })

  it('renders an arbitrary section list with no app-specific knowledge', () => {
    // The extraction boundary: this component takes sections and nothing else.
    const custom: SettingsSection[] = [{ id: 'x', label: 'Anything', render: () => <div>arbitrary</div> }]
    render(<SettingsModal open sections={custom} onClose={vi.fn()} />)
    expect(screen.getByText('arbitrary')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Anything' })).toBeInTheDocument()
  })
})
