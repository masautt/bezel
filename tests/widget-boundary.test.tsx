import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WidgetBoundary } from '../client/src/WidgetBoundary'

function Boom(): never { throw new Error('kaboom') }

describe('WidgetBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('renders children when nothing throws', () => {
    render(<WidgetBoundary name="Context"><p>fine</p></WidgetBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('renders a compact failed state naming the widget when a child throws', () => {
    render(<WidgetBoundary name="Context"><Boom /></WidgetBoundary>)
    expect(screen.getByText(/Context unavailable/)).toBeTruthy()
  })
})
