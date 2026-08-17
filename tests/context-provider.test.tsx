import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ContextProvider, useProjectContext } from '../client/src/ContextProvider'

function Probe() {
  const { context, setCwd } = useProjectContext()
  return (
    <div>
      <span data-testid="org">{context.org ?? '-'}</span>
      <span data-testid="repo">{context.repo ?? '-'}</span>
      <span data-testid="cwd">{context.cwd}</span>
      <span data-testid="pinned">{context.pinned ? 'yes' : 'no'}</span>
      <button onClick={() => setCwd('C:/Users/testuser/source/orgs/devkit-inc/localhub/client')}>go</button>
    </div>
  )
}

const read = (id: string) => screen.getByTestId(id).textContent

const ROOTS = [
  'C:/Users/testuser/source/orgs/devkit-inc/localhub',
  'C:/Users/testuser/source/orgs/devkit-inc/bezel',
]

describe('ContextProvider', () => {
  it('starts at the given cwd', () => {
    render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    expect(screen.getByTestId('org').textContent).toBe('-')
  })

  it('re-resolves org and repo when setCwd is called (a glance)', () => {
    render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    act(() => { screen.getByText('go').click() })
    expect(screen.getByTestId('org').textContent).toBe('devkit-inc')
    expect(screen.getByTestId('repo').textContent).toBe('localhub')
  })

  it('resolves nothing until the repo roots arrive', () => {
    render(
      <ContextProvider cwd="C:/Users/testuser/source/orgs/devkit-inc/localhub" activeId={1} repoRoots={[]}>
        <Probe />
      </ContextProvider>
    )
    expect(screen.getByTestId('org').textContent).toBe('devkit-inc')
    expect(screen.getByTestId('repo').textContent).toBe('-')
  })

  it('re-syncs, resetting a glance, when the cwd prop changes', () => {
    const { rerender } = render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    // Glance at another repo via setCwd, without the tab actually moving.
    act(() => { screen.getByText('go').click() })
    expect(screen.getByTestId('repo').textContent).toBe('localhub')

    // The active tab's real cwd changes to a THIRD directory (e.g. a tab
    // switch, or the active tab's own OSC 7 update) — this must win over the
    // glance, landing on `bezel` rather than staying on the glanced `localhub`.
    rerender(
      <ContextProvider cwd="C:/Users/testuser/source/orgs/devkit-inc/bezel" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    expect(screen.getByTestId('org').textContent).toBe('devkit-inc')
    expect(screen.getByTestId('repo').textContent).toBe('bezel')
  })

  it('re-syncs on a switch between two tabs that share a cwd', () => {
    // createTab always opens fresh tabs at the same DEFAULT_ROOT, so two tabs
    // sharing a cwd string is ordinary usage, not a corner case. The cwd prop
    // alone can't signal that switch (it doesn't change), so activeId must.
    const { rerender } = render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    // Glance at another repo via setCwd, without the tab actually moving.
    act(() => { screen.getByText('go').click() })
    expect(read('repo')).toBe('localhub')
    expect(read('pinned')).toBe('no')

    // Switch to a different tab whose cwd happens to be identical — cwd is
    // unchanged, only activeId is. The glance must still be reset.
    rerender(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={2} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    // The cwd state IS reset — that is what `pinned` proves. The glanced repo
    // stays on screen only because the new cwd resolves to nothing and the pin
    // fills the vacuum; before this change the gutters simply went dark here.
    expect(read('cwd')).toBe('C:/Users/testuser/source')
    expect(read('pinned')).toBe('yes')
    expect(read('repo')).toBe('localhub')
  })
})

describe('ContextProvider sticky resolution', () => {
  const BEZEL = 'C:/Users/testuser/source/orgs/devkit-inc/bezel'
  const SOURCE = 'C:/Users/testuser/source'

  const renderAt = (cwd: string) =>
    render(
      <ContextProvider cwd={cwd} activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )

  it('reports an unpinned context inside a repo', () => {
    renderAt(BEZEL)
    expect(read('org')).toBe('devkit-inc')
    expect(read('repo')).toBe('bezel')
    expect(read('pinned')).toBe('no')
  })

  it('keeps the repo and flags it pinned after moving outside orgs/', () => {
    const { rerender } = renderAt(BEZEL)
    rerender(
      <ContextProvider cwd={SOURCE} activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    expect(read('org')).toBe('devkit-inc')
    expect(read('repo')).toBe('bezel')
    expect(read('pinned')).toBe('yes')
  })

  it('still reports the live cwd while pinned', () => {
    const { rerender } = renderAt(BEZEL)
    rerender(
      <ContextProvider cwd={SOURCE} activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    // The pin substitutes org/repo/root only. cwd is never stale.
    expect(read('cwd')).toBe(SOURCE)
  })

  it('has nothing to pin on a first launch', () => {
    renderAt(SOURCE)
    expect(read('org')).toBe('-')
    expect(read('repo')).toBe('-')
    expect(read('pinned')).toBe('no')
  })

  it('lets a real org-only directory replace the pin', () => {
    const { rerender } = renderAt(BEZEL)
    rerender(
      <ContextProvider cwd="C:/Users/testuser/source/orgs/sbrain-inc" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    expect(read('org')).toBe('sbrain-inc')
    expect(read('repo')).toBe('-')
    expect(read('pinned')).toBe('no')
  })

  it('persists a newly resolved repo root exactly once per repo', () => {
    const { rerender } = renderAt(SOURCE)
    rerender(
      <ContextProvider cwd={BEZEL} activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    rerender(
      <ContextProvider cwd={`${BEZEL}/client/src`} activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    // A deeper cd inside the same repo resolves to the same root, so it must
    // not re-fire — this is why rememberRepo is its own channel rather than a
    // second argument to `remember`, which fires on every prompt.
    expect(window.bezel.project.rememberRepo).toHaveBeenCalledTimes(1)
    expect(window.bezel.project.rememberRepo).toHaveBeenCalledWith(BEZEL)
  })

  it('does not re-remember its own pinned value', () => {
    const { rerender } = renderAt(BEZEL)
    rerender(
      <ContextProvider cwd={SOURCE} activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    rerender(
      <ContextProvider cwd="D:/elsewhere" activeId={1} repoRoots={ROOTS}>
        <Probe />
      </ContextProvider>
    )
    // Both rerenders are pinned; only the original resolution wrote.
    expect(window.bezel.project.rememberRepo).toHaveBeenCalledTimes(1)
  })
})
