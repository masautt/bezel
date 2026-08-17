import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Divider, type DividerProps } from '../client/src/Divider'

// jsdom implements no part of the Pointer Capture API. The divider calls
// setPointerCapture so a drag keeps tracking after the cursor leaves the 4px
// handle — real behavior worth keeping, so stub the gap rather than guarding
// the component against an environment it never actually runs in.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const GRID_H = 800
const GRID_W = 1600
const GUTTER_H = 400

/**
 * jsdom reports 0 for every clientHeight/clientWidth, so the measured ancestors
 * are stubbed. Both a `.grid` and a nested `.gutter` are rendered so the
 * `measure` selector has two candidates to choose between — which is the whole
 * point of the prop.
 */
function mount(props: Partial<DividerProps> = {}) {
  const onDrag = vi.fn()
  const onReset = vi.fn()
  render(
    <div className="grid" data-testid="grid">
      <div className="gutter" data-testid="gutter">
        <Divider onDrag={onDrag} onReset={onReset} {...props} />
      </div>
    </div>
  )
  const size = (id: string, w: number, h: number) => {
    const el = screen.getByTestId(id)
    Object.defineProperty(el, 'clientWidth', { value: w, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: h, configurable: true })
  }
  size('grid', GRID_W, GRID_H)
  size('gutter', 240, GUTTER_H)
  return { onDrag, onReset, handle: screen.getByRole('separator') }
}

function drag(handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(window)
}

describe('Divider', () => {
  it('reports a vertical drag from clientX, normalized by the ancestor width', () => {
    const { onDrag, handle } = mount({ orientation: 'vertical' })
    drag(handle, { x: 100, y: 0 }, { x: 180, y: 0 })
    expect(onDrag).toHaveBeenLastCalledWith(80 / GRID_W, 80)
  })

  it('reports a horizontal drag from clientY, normalized by the ancestor height', () => {
    const { onDrag, handle } = mount()
    drag(handle, { x: 0, y: 100 }, { x: 0, y: 140 })
    expect(onDrag).toHaveBeenLastCalledWith(40 / GRID_H, 40)
  })

  it('ignores movement on the other axis', () => {
    const { onDrag, handle } = mount({ orientation: 'vertical' })
    drag(handle, { x: 100, y: 0 }, { x: 100, y: 300 })
    expect(onDrag).toHaveBeenLastCalledWith(0, 0)
  })

  it('measures the named ancestor rather than the default .grid', () => {
    const { onDrag, handle } = mount({ measure: '.gutter' })
    drag(handle, { x: 0, y: 0 }, { x: 0, y: 50 })
    expect(onDrag).toHaveBeenLastCalledWith(50 / GUTTER_H, 50)
  })

  it('reports each move relative to the previous one, not the origin', () => {
    const { onDrag, handle } = mount()
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 0, clientY: 30 })
    fireEvent.pointerMove(window, { clientX: 0, clientY: 50 })
    expect(onDrag).toHaveBeenLastCalledWith(20 / GRID_H, 20)
    fireEvent.pointerUp(window)
  })

  it('sets the right aria-orientation for each axis', () => {
    const { handle } = mount({ orientation: 'vertical' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('fires onReset on a double click and never onDrag', () => {
    const { onDrag, onReset, handle } = mount()
    fireEvent.doubleClick(handle)
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('stops reporting after pointerup', () => {
    const { onDrag, handle } = mount()
    drag(handle, { x: 0, y: 0 }, { x: 0, y: 40 })
    onDrag.mockClear()
    fireEvent.pointerMove(window, { clientX: 0, clientY: 400 })
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('stops reporting after pointercancel', () => {
    // A drag released outside the window arrives as pointercancel, not
    // pointerup; without both bound the listeners leak and the divider keeps
    // tracking a pointer that is no longer down.
    const { onDrag, handle } = mount()
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerCancel(window)
    onDrag.mockClear()
    fireEvent.pointerMove(window, { clientX: 0, clientY: 200 })
    expect(onDrag).not.toHaveBeenCalled()
  })
})
