import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ContextProvider } from '../client/src/ContextProvider'
import { WindowWidget } from '../client/src/widgets/WindowWidget'
import { UsageWidget } from '../client/src/widgets/UsageWidget'
import { Meter } from '../client/src/widgets/Meter'
import type { ContextMeter } from '@shared/context-meter'
import type { UsageSnapshot } from '@shared/usage'

const CWD = 'C:/Users/testuser/source/orgs/devkit-inc/bezel'

function stubMeter(result: ContextMeter | null) {
  const meter = vi.fn().mockResolvedValue(result)
  window.bezel = { ...window.bezel, claudeContext: { meter } } as typeof window.bezel
  return meter
}

function stubUsage(result: UsageSnapshot | null) {
  const get = vi.fn().mockResolvedValue(result)
  window.bezel = { ...window.bezel, usage: { get } } as typeof window.bezel
  return get
}

const SESSION = 'aaaaaaaa-1111-4222-8333-444444444444'

const renderWindow = (sessionId?: string) =>
  render(
    <ContextProvider cwd={CWD} activeId={1} sessionId={sessionId} repoRoots={[CWD]}>
      <WindowWidget />
    </ContextProvider>
  )

afterEach(() => vi.restoreAllMocks())

describe('Meter', () => {
  it('reports its value to assistive tech, so the bar is not the only carrier', () => {
    render(<Meter label="session · 5h" percent={66} severity="normal" note="2h 20m left" />)
    const meter = screen.getByRole('meter', { name: 'session · 5h' })
    expect(meter).toHaveAttribute('aria-valuenow', '66')
    expect(meter).toHaveAttribute('aria-valuetext', '66%, 2h 20m left')
  })

  it('carries severity on the wrapper, where the CSS reads it', () => {
    const { container } = render(<Meter label="x" percent={95} severity="critical" />)
    expect(container.querySelector('.meter')).toHaveAttribute('data-severity', 'critical')
  })

  it('clamps a fill that would otherwise overflow its track', () => {
    const { container } = render(<Meter label="x" percent={140} severity="critical" />)
    expect(container.querySelector<HTMLElement>('.meter-fill')!.style.width).toBe('100%')
  })
})

describe('WindowWidget', () => {
  const meter: ContextMeter = {
    tokens: 142_400, limit: 200_000, percent: 71, severity: 'warn',
    model: 'claude-opus-5', at: new Date().toISOString(),
  }

  it('gauges the window and names what it is gauging against', async () => {
    stubMeter(meter)
    renderWindow()
    expect(await screen.findByRole('meter', { name: '142k / 200k' })).toHaveAttribute('aria-valuenow', '71')
    expect(screen.getByText('opus-5')).toBeInTheDocument()
  })

  // Not "0%": no transcript for this directory means there is no window to
  // measure, and an empty bar is a claim about one that does not exist.
  it('says there is no session rather than painting an empty bar', async () => {
    stubMeter(null)
    renderWindow()
    expect(await screen.findByText('no session here')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('shows nothing but "reading…" before the first answer lands', () => {
    stubMeter(meter)
    renderWindow()
    expect(screen.getByText('reading…')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  // The reading advances one step per assistant turn, so a bar frozen mid-run
  // must not pass for a live one.
  it('marks a reading that has gone quiet as idle', async () => {
    stubMeter({ ...meter, at: new Date(Date.now() - 10 * 60_000).toISOString() })
    renderWindow()
    expect(await screen.findByTestId('window-stale')).toBeInTheDocument()
  })

  it('does not call a fresh reading idle', async () => {
    stubMeter(meter)
    renderWindow()
    await screen.findByRole('meter')
    expect(screen.queryByTestId('window-stale')).toBeNull()
  })

  // The live cwd, not the sticky repo root: the session whose window this is
  // runs where the pane actually is.
  it('measures the live cwd', async () => {
    const spy = stubMeter(meter)
    renderWindow()
    await waitFor(() => expect(spy).toHaveBeenCalledWith(CWD, undefined))
  })

  // Every claude pane is rooted at the same directory, so a cwd-only reading
  // returns whichever session on the machine wrote last — with two tabs open,
  // routinely the other one's. The id is what makes this gauge the ACTIVE
  // tab's.
  it('names the session belonging to the active tab when it has one', async () => {
    const spy = stubMeter(meter)
    renderWindow(SESSION)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(CWD, SESSION))
  })
})

describe('UsageWidget', () => {
  const snapshot: UsageSnapshot = {
    session: { percent: 66, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), severity: 'normal' },
    weekly: { percent: 56, resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), severity: 'normal' },
    extra: { usedMinor: 0, limitMinor: 2000, currency: 'USD', exponent: 2 },
    fetchedAt: new Date().toISOString(),
  }

  it('shows both windows at once — they fail differently', async () => {
    stubUsage(snapshot)
    render(<UsageWidget />)
    expect(await screen.findByRole('meter', { name: 'session · 5h' })).toHaveAttribute('aria-valuenow', '66')
    expect(screen.getByRole('meter', { name: 'weekly · 7d' })).toHaveAttribute('aria-valuenow', '56')
  })

  it('counts down to each reset', async () => {
    stubUsage(snapshot)
    render(<UsageWidget />)
    expect(await screen.findByText('1h 59m left')).toBeInTheDocument()
    expect(screen.getByText('1d 23h left')).toBeInTheDocument()
  })

  it('shows the credit balance when the account can spend one', async () => {
    stubUsage(snapshot)
    render(<UsageWidget />)
    expect(await screen.findByText('credits $0.00 / $20.00')).toBeInTheDocument()
  })

  it('omits the credit row when there is none', async () => {
    stubUsage({ ...snapshot, extra: null })
    render(<UsageWidget />)
    await screen.findByRole('meter', { name: 'session · 5h' })
    expect(screen.queryByText(/credits/)).toBeNull()
  })

  // "You have used none of your limit" is the most misleading thing this widget
  // could say while knowing nothing.
  it('says unavailable rather than showing zeroed bars', async () => {
    stubUsage(null)
    render(<UsageWidget />)
    expect(await screen.findByText('unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('renders whichever window came back when the other did not', async () => {
    stubUsage({ ...snapshot, weekly: null })
    render(<UsageWidget />)
    expect(await screen.findByRole('meter', { name: 'session · 5h' })).toBeInTheDocument()
    expect(screen.queryByRole('meter', { name: 'weekly · 7d' })).toBeNull()
  })
})
