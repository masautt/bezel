import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionWidget } from '../client/src/widgets/SessionWidget'

describe('SessionWidget', () => {
  it('shows an empty state before claude has reported anything', () => {
    render(<SessionWidget history={[]} />)
    expect(screen.getByText('nothing yet')).toBeInTheDocument()
  })

  it('renders every entry in order', () => {
    render(<SessionWidget history={['Third', 'Second', 'First']} />)
    const rows = screen.getAllByTestId('session-entry')
    expect(rows.map(r => r.textContent)).toEqual(['Third', 'Second', 'First'])
  })

  it('marks only the newest entry as current', () => {
    render(<SessionWidget history={['Newest', 'Older']} />)
    const rows = screen.getAllByTestId('session-entry')
    expect(rows[0]).toHaveClass('current')
    expect(rows[1]).not.toHaveClass('current')
  })

  it('titles the widget Session', () => {
    render(<SessionWidget history={[]} />)
    expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument()
  })

  it('renders a long summary in full in the DOM, with no truncation applied by the component', () => {
    const long = 'Investigating why the specs sync hook writes zero bytes on Windows'
    render(<SessionWidget history={[long]} />)
    expect(screen.getByTestId('session-entry')).toHaveTextContent(long)
  })
})
