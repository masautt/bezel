import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Gutter } from '../client/src/Gutter'
import { DEFAULT_LAYOUT, type SlotState, type WidgetId } from '@shared/layout'

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

type Nodes = Partial<Record<WidgetId, ReactNode>>

const NODES: Nodes = {
  context: <div>ctx-body</div>,
  changes: <div>changes-body</div>,
}

function mount(slots: SlotState[] = DEFAULT_LAYOUT.slots.left, nodes: Nodes = NODES) {
  const onResize = vi.fn()
  const onToggle = vi.fn()
  const onReset = vi.fn()
  const { container } = render(
    <Gutter side="left" slots={slots} nodes={nodes} onResize={onResize} onToggle={onToggle} onReset={onReset} />
  )
  return { onResize, onToggle, onReset, container }
}

describe('Gutter', () => {
  it('renders one grabber fewer than it has slots', () => {
    // Nothing sits below the last slot to trade space with.
    mount()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('renders each slot in array order', () => {
    const { container } = mount()
    const ids = [...container.querySelectorAll('.slot')].map(el => el.getAttribute('data-slot'))
    expect(ids).toEqual(['context', 'changes'])
  })

  it('follows a reordered slot array', () => {
    const { container } = mount([DEFAULT_LAYOUT.slots.left[1], DEFAULT_LAYOUT.slots.left[0]])
    const ids = [...container.querySelectorAll('.slot')].map(el => el.getAttribute('data-slot'))
    expect(ids).toEqual(['changes', 'context'])
  })

  it('applies a fractional height as a flex basis', () => {
    const { container } = mount()
    expect(container.querySelector('[data-slot="changes"]')).toHaveStyle({ flex: '0 0 45.00%' })
  })

  it('gives an auto slot no inline flex basis', () => {
    const { container } = mount()
    expect(container.querySelector<HTMLElement>('[data-slot="context"]')!.style.flex).toBe('')
  })

  it('drops the flex basis while collapsed', () => {
    // A collapsed widget is header-only, so it must not keep reserving height.
    const collapsed = [{ ...DEFAULT_LAYOUT.slots.left[1], collapsed: true }]
    const { container } = mount(collapsed, { changes: <div>changes-body</div> })
    const el = container.querySelector<HTMLElement>('[data-slot="changes"]')!
    expect(el.style.flex).toBe('')
    expect(el.className).toContain('collapsed')
  })

  it('skips hidden slots and the grabber that went with them', () => {
    const slots = [DEFAULT_LAYOUT.slots.left[0], { ...DEFAULT_LAYOUT.slots.left[1], hidden: true }]
    mount(slots)
    expect(screen.queryByText('changes-body')).toBeNull()
    expect(screen.queryAllByRole('separator')).toHaveLength(0)
  })

  it('skips a slot with no node rather than throwing', () => {
    mount(DEFAULT_LAYOUT.slots.left, { context: <div>ctx-body</div> })
    expect(screen.getByText('ctx-body')).toBeInTheDocument()
    expect(screen.queryAllByRole('separator')).toHaveLength(0)
  })

  it('reports a grabber drag against the slot above it', () => {
    const { onResize } = mount()
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 })
    fireEvent.pointerUp(window)
    // The grabber after `context` resizes `context`, not `changes`.
    expect(onResize).toHaveBeenCalledWith('context', expect.any(Number), expect.any(Number))
  })

  it('resets the slot above on a double click', () => {
    const { onReset } = mount()
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(onReset).toHaveBeenCalledWith('context')
  })
})
