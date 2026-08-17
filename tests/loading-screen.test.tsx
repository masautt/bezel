import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LoadingScreen } from '../client/src/LoadingScreen'
import { BUILTIN_LOADING_MESSAGES, LOADING_CACHE_KEY } from '../src/loading-messages'

const builtinTexts = BUILTIN_LOADING_MESSAGES.map(x => x.text)

/** The rotating line alone. `role="status"` wraps the brand and detail too, so
 *  reading its whole textContent would compare against "bezel…" every time. */
const currentMessage = (container: HTMLElement) =>
  container.querySelector('.loading-message')?.textContent?.trim()

describe('LoadingScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a built-in message when nothing is cached', () => {
    const { container } = render(<LoadingScreen />)
    expect(builtinTexts).toContain(currentMessage(container))
  })

  it('prefers the cached remote set over the built-ins', () => {
    window.localStorage.setItem(LOADING_CACHE_KEY, JSON.stringify([{ text: 'from the cache', weight: 1 }]))
    render(<LoadingScreen />)
    expect(screen.getByRole('status')).toHaveTextContent('from the cache')
  })

  it('accepts the table shape straight from a pull, uncoverted', () => {
    // App caches exactly what `loading.pull()` returned, so the component has to
    // read `message` as happily as `text`.
    window.localStorage.setItem(LOADING_CACHE_KEY, JSON.stringify([{ message: 'raw row', weight: 1 }]))
    render(<LoadingScreen />)
    expect(screen.getByRole('status')).toHaveTextContent('raw row')
  })

  it('falls back to the built-ins when the cache is corrupt or empty', () => {
    for (const junk of ['not json at all', '[]', 'null', '[{"nope":1}]']) {
      window.localStorage.setItem(LOADING_CACHE_KEY, junk)
      const { container, unmount } = render(<LoadingScreen />)
      // A corrupt blob must degrade to the built-ins, never to a blank screen.
      expect(builtinTexts).toContain(currentMessage(container))
      unmount()
    }
  })

  it('survives localStorage being unavailable entirely', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const { container } = render(<LoadingScreen />)
    expect(builtinTexts).toContain(currentMessage(container))
  })

  it('rotates to a different message, and never repeats back to back', () => {
    vi.useFakeTimers()
    window.localStorage.setItem(
      LOADING_CACHE_KEY,
      JSON.stringify([{ text: 'one' }, { text: 'two' }, { text: 'three' }])
    )
    const { container } = render(<LoadingScreen />)
    const seen = [currentMessage(container)]
    for (let i = 0; i < 5; i++) {
      act(() => { vi.advanceTimersByTime(2500) })
      const now = currentMessage(container)
      expect(now).not.toBe(seen[seen.length - 1])
      seen.push(now)
    }
    expect(seen).toHaveLength(6)
  })

  it('does not rotate when there is only one message to show', () => {
    vi.useFakeTimers()
    window.localStorage.setItem(LOADING_CACHE_KEY, JSON.stringify([{ text: 'the only one' }]))
    render(<LoadingScreen />)
    act(() => { vi.advanceTimersByTime(2500 * 4) })
    expect(screen.getByRole('status')).toHaveTextContent('the only one')
  })

  it('announces politely as progress, not as an alert', () => {
    render(<LoadingScreen detail="starting your terminals" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('starting your terminals')
  })

  it('omits the detail line when none is given', () => {
    const { container } = render(<LoadingScreen />)
    expect(container.querySelector('.loading-detail')).toBeNull()
  })
})
