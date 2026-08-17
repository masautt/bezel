import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutSection, type LayoutSectionProps } from '../client/src/settings/sections/LayoutSection'
import { DEFAULT_STORE, savePresetAs, setLive, type LayoutStore } from '@shared/presets'
import { DEFAULT_LAYOUT, resizeGutter, setHidden } from '@shared/layout'

const T1 = '2026-08-09T10:00:00.000Z'
const wide = resizeGutter(DEFAULT_LAYOUT, 'left', 60)
const withCoding = savePresetAs(DEFAULT_STORE, 'coding', 'p1', T1)

function mount(store: LayoutStore = DEFAULT_STORE, over: Partial<LayoutSectionProps> = {}) {
  const handlers = {
    onApply: vi.fn(), onSaveAs: vi.fn(), onSaveToActive: vi.fn(), onRename: vi.fn(),
    onDelete: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onResetLive: vi.fn(),
  }
  render(<LayoutSection store={store} {...handlers} {...over} />)
  return handlers
}

describe('LayoutSection presets', () => {
  it('applies the chosen preset', async () => {
    const { onApply } = mount(withCoding)
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'default')
    expect(onApply).toHaveBeenCalledWith('default')
  })

  it('disables Rename and Delete for the built-in default', () => {
    mount(DEFAULT_STORE)
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('enables them for a user preset', () => {
    mount(withCoding)
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('shows drift and only then offers Save', async () => {
    // The live layout is deliberately not the preset, so Save has to be
    // reachable exactly when there is something to save.
    mount(withCoding)
    expect(screen.queryByTestId('dirty')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    mount(setLive(withCoding, wide))
    expect(screen.getAllByTestId('dirty').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Save' })[1]).toBeEnabled()
  })

  it('never offers Save on the built-in default, even when drifted', () => {
    mount(setLive(DEFAULT_STORE, wide))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves as a new preset through an inline input, not window.prompt', async () => {
    // window.prompt blocks the renderer — the same reason the Apps widget arms
    // instead of calling window.confirm.
    const { onSaveAs } = mount(withCoding)
    await userEvent.click(screen.getByRole('button', { name: 'Save as…' }))
    await userEvent.type(screen.getByLabelText('New preset name'), 'review')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSaveAs).toHaveBeenCalledWith('review')
  })

  it('commits a rename on Enter and seeds the input with the current name', async () => {
    const { onRename } = mount(withCoding)
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Rename preset')
    expect(input).toHaveValue('coding')
    await userEvent.clear(input)
    await userEvent.type(input, 'review{Enter}')
    expect(onRename).toHaveBeenCalledWith('p1', 'review')
  })

  it('abandons the draft on Cancel', async () => {
    const { onSaveAs } = mount(withCoding)
    await userEvent.click(screen.getByRole('button', { name: 'Save as…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSaveAs).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('New preset name')).toBeNull()
  })
})

describe('LayoutSection widget list', () => {
  it('toggles visibility off and back on', async () => {
    const { onToggleHidden } = mount(DEFAULT_STORE)
    await userEvent.click(screen.getByRole('checkbox', { name: /Usage/ }))
    expect(onToggleHidden).toHaveBeenCalledWith('right', 'usage', true)

    const hidden = setLive(DEFAULT_STORE, setHidden(DEFAULT_LAYOUT, 'right', 'usage', true))
    const second = mount(hidden)
    await userEvent.click(screen.getAllByRole('checkbox', { name: /Usage/ })[1])
    expect(second.onToggleHidden).toHaveBeenCalledWith('right', 'usage', false)
  })

  it('reorders within a gutter', async () => {
    const { onMove } = mount(DEFAULT_STORE)
    await userEvent.click(screen.getByRole('button', { name: 'Move Changes up' }))
    expect(onMove).toHaveBeenCalledWith('left', 'changes', -1)
  })

  it('disables the move buttons at each end', () => {
    mount(DEFAULT_STORE)
    expect(screen.getByRole('button', { name: 'Move Context up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Changes down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Changes up' })).toBeEnabled()
  })

  it('lists both gutters in render order', () => {
    mount(DEFAULT_STORE)
    const boxes = screen.getAllByRole('checkbox').map(b => b.closest('label')?.textContent)
    expect(boxes).toEqual(['Context', 'Changes', 'Session', 'Specs', 'Window', 'Usage'])
  })
})
