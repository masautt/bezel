import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabStrip } from '../client/src/TabStrip'
import type { Tab } from '../src/tabs'

const ROOT = 'C:/Users/testuser/source'
const BEZEL = `${ROOT}/orgs/devkit-inc/bezel`

function tab(over: Partial<Tab> & { id: number }): Tab {
  return { cwd: ROOT, history: [], closeArmed: false, attention: false, ...over }
}

function setup(tabs: Tab[], activeId = tabs[0].id) {
  const onSelect = vi.fn()
  const onCloseIntent = vi.fn()
  const onNew = vi.fn()
  // Every tab booted and none missing by default — this suite is about the
  // strip's label/click/attention behavior, not dormant/missing rendering
  // (see tests/tab-restore.test.tsx for those), so the default keeps every
  // existing assertion here on the same "fully live" tab it always exercised.
  const { container } = render(
    <TabStrip
      tabs={tabs}
      activeId={activeId}
      repoRoots={[BEZEL]}
      booted={new Set(tabs.map(t => t.id))}
      missing={new Set()}
      onSelect={onSelect}
      onCloseIntent={onCloseIntent}
      onNew={onNew}
    />
  )
  return { container, onSelect, onCloseIntent, onNew, user: userEvent.setup() }
}

describe('TabStrip', () => {
  it('labels a tab with its repo name until a title arrives', () => {
    setup([tab({ id: 1, cwd: BEZEL })])
    expect(screen.getByRole('button', { name: 'bezel' })).toBeInTheDocument()
  })

  it('prefers the reported title over the repo name', () => {
    setup([tab({ id: 1, cwd: BEZEL, history: ['Adding tabs to bezel'] })])
    expect(screen.getByRole('button', { name: 'Adding tabs to bezel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'bezel' })).not.toBeInTheDocument()
  })

  it('exposes the full label as a tooltip, since the visible text truncates', () => {
    setup([tab({ id: 1, history: ['A very long summary of what claude is doing'] })])
    expect(screen.getByRole('button', { name: 'A very long summary of what claude is doing' }))
      .toHaveAttribute('title', 'A very long summary of what claude is doing')
  })

  it('marks the active tab', () => {
    setup([tab({ id: 1, cwd: BEZEL }), tab({ id: 2 })], 2)
    expect(screen.getByRole('button', { name: 'source' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'bezel' })).not.toHaveAttribute('aria-current')
  })

  it('reports a click on a tab', async () => {
    const { onSelect, user } = setup([tab({ id: 1, cwd: BEZEL }), tab({ id: 2 })])
    await user.click(screen.getByRole('button', { name: 'source' }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('reports a click on +', async () => {
    const { onNew, user } = setup([tab({ id: 1 })])
    await user.click(screen.getByRole('button', { name: 'New tab' }))
    expect(onNew).toHaveBeenCalled()
  })

  it('offers a close button even when only one tab is open', () => {
    setup([tab({ id: 1, cwd: BEZEL })])
    expect(screen.getByRole('button', { name: 'Close bezel' })).toBeInTheDocument()
  })

  it('offers a close button per tab once there are two', () => {
    setup([tab({ id: 1, cwd: BEZEL }), tab({ id: 2 })])
    expect(screen.getAllByRole('button', { name: /^Close/ })).toHaveLength(2)
  })

  it('reports close intent rather than closing', async () => {
    const { onCloseIntent, user } = setup([tab({ id: 1, cwd: BEZEL }), tab({ id: 2 })])
    await user.click(screen.getByRole('button', { name: 'Close bezel' }))
    expect(onCloseIntent).toHaveBeenCalledWith(1)
  })

  it('shows an armed tab as needing a second click', () => {
    setup([tab({ id: 1, cwd: BEZEL, closeArmed: true }), tab({ id: 2 })])
    const armed = screen.getByRole('button', { name: 'Click again to close bezel' })
    expect(armed).toHaveClass('arming')
    // A checkmark on a solid fill, not just a color change — the pointer is
    // still on the button, where :hover has already applied the accent color.
    expect(armed).toHaveTextContent('✓')
    expect(screen.getByRole('button', { name: 'Close source' })).toHaveTextContent('✕')
  })
})

describe('TabStrip: a session ready for you', () => {
  it('says so in words, not only in color and motion', () => {
    setup([tab({ id: 1, cwd: BEZEL, attention: true }), tab({ id: 2 })], 2)
    const ready = screen.getByRole('button', { name: 'bezel — ready for you' })
    expect(ready).toHaveAttribute('title', 'bezel — ready for you')
  })

  it('marks the tab so the outline can pulse', () => {
    const { container } = setup([tab({ id: 1, cwd: BEZEL, attention: true }), tab({ id: 2 })], 2)
    const tabs = container.querySelectorAll('.tab')
    expect(tabs[0]).toHaveClass('ready')
    expect(tabs[1]).not.toHaveClass('ready')
  })

  it('draws the dot inside the label button, so clicking it switches', async () => {
    const { container, onSelect, user } = setup([tab({ id: 1, cwd: BEZEL, attention: true }), tab({ id: 2 })], 2)
    const dot = container.querySelector('.tab-dot')
    expect(dot).not.toBeNull()
    expect(dot!.closest('button')).toHaveClass('tab-label')
    await user.click(screen.getByRole('button', { name: 'bezel — ready for you' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('leaves an unmarked tab alone, in name and in markup', () => {
    const { container } = setup([tab({ id: 1, cwd: BEZEL })])
    expect(screen.getByRole('button', { name: 'bezel' })).toBeInTheDocument()
    expect(container.querySelector('.tab-dot')).toBeNull()
  })
})
