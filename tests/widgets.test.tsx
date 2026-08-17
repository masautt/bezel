import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextProvider } from '../client/src/ContextProvider'
import { Widget, SlotContext } from '../client/src/widgets/Widget'
import { ContextWidget } from '../client/src/widgets/ContextWidget'
import { ChangesWidget } from '../client/src/widgets/ChangesWidget'
import { SpecsWidget } from '../client/src/widgets/SpecsWidget'
import type { GitInfo, AppEntry, SpecItem } from '@shared/types'

const ROOTS = ['C:/Users/testuser/source/orgs/devkit-inc/localhub']
const REPO_CWD = 'C:/Users/testuser/source/orgs/devkit-inc/localhub'

function stubSpecsList(result: SpecItem[] | null) {
  const list = vi.fn().mockResolvedValue(result)
  const open = vi.fn().mockResolvedValue('local')
  window.bezel = {
    ...window.bezel,
    specs: { list, open },
  } as typeof window.bezel
  return { list, open }
}

function stubGitInfo(info: GitInfo | null) {
  const spy = vi.fn().mockResolvedValue(info)
  window.bezel = {
    ...window.bezel,
    git: { info: spy },
  } as typeof window.bezel
  return spy
}

describe('Widget', () => {
  it('renders a header-right slot', () => {
    render(<Widget title="Apps" headerRight={<button>orgs</button>}>body</Widget>)
    expect(screen.getByRole('button', { name: 'orgs' })).toBeInTheDocument()
  })

  it('leaves the header inert with no collapse handler', () => {
    render(<Widget title="Specs">body</Widget>)
    expect(screen.queryByRole('button', { name: 'Specs' })).toBeNull()
  })

  it('hides the body when collapsed but keeps the header', () => {
    render(<Widget title="Specs" collapsed>body</Widget>)
    expect(screen.getByText('Specs')).toBeInTheDocument()
    expect(screen.queryByText('body')).toBeNull()
  })

  it('toggles on a header click', async () => {
    const onToggleCollapse = vi.fn()
    render(<Widget title="Specs" onToggleCollapse={onToggleCollapse}>body</Widget>)
    await userEvent.click(screen.getByRole('button', { name: 'Specs' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('does not swallow a click on a control inside the header', async () => {
    // The Apps view switcher lives here. Without stopPropagation on the slot,
    // choosing a view would also collapse the widget.
    const onToggleCollapse = vi.fn()
    const onPick = vi.fn()
    render(
      <Widget title="Apps" onToggleCollapse={onToggleCollapse} headerRight={<button onClick={onPick}>orgs</button>}>
        body
      </Widget>
    )
    await userEvent.click(screen.getByRole('button', { name: 'orgs' }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })
})

describe('ContextWidget', () => {
  beforeEach(() => { vi.useRealTimers() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows the abbreviated cwd when there is no recognized org', async () => {
    stubGitInfo({ branch: null, ahead: 0, dirty: [] })
    render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={[]}>
        <ContextWidget />
      </ContextProvider>
    )
    expect(screen.getByText('~/source')).toBeTruthy()
  })

  it('shows the live cwd when it differs from the repo root', async () => {
    stubGitInfo({ branch: 'main', ahead: 0, dirty: [] })
    render(
      <ContextProvider cwd={`${REPO_CWD}/client/src`} activeId={1} repoRoots={ROOTS}>
        <ContextWidget />
      </ContextProvider>
    )
    expect(screen.getByTestId('context-cwd').textContent).toBe('~/source/orgs/devkit-inc/localhub/client/src')
  })

  it('omits the cwd row at the repo root', async () => {
    // It would only restate the two rows above it.
    stubGitInfo({ branch: 'main', ahead: 0, dirty: [] })
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ContextWidget />
      </ContextProvider>
    )
    expect(screen.queryByTestId('context-cwd')).toBeNull()
  })

  it('marks a pinned context and still shows the real cwd', async () => {
    stubGitInfo({ branch: 'main', ahead: 0, dirty: [] })
    const { rerender } = render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ContextWidget />
      </ContextProvider>
    )
    // Walk out of orgs/ entirely — the state bezel launches into.
    rerender(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={ROOTS}>
        <ContextWidget />
      </ContextProvider>
    )
    expect(screen.getByText(/pinned/)).toBeTruthy()
    expect(screen.getByText('localhub')).toBeTruthy()
    expect(screen.getByTestId('context-cwd').textContent).toBe('~/source')
  })

  it('shows org, repo, and branch info when inside a recognized repo', async () => {
    stubGitInfo({ branch: 'main', ahead: 2, dirty: ['a.txt', 'b.txt'] })
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ContextWidget />
      </ContextProvider>
    )
    expect(screen.getByText('devkit-inc')).toBeTruthy()
    expect(screen.getByText('localhub')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText(/main/)).toBeTruthy()
      expect(screen.getByText(/2 ahead/)).toBeTruthy()
      expect(screen.getByText(/2 dirty/)).toBeTruthy()
    })
  })
})

describe('ChangesWidget', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // "clean" is a positive claim about the repo. These cover the two states that
  // used to make it, wrongly: a status call still in flight, and one that failed.
  it('says "reading…", not "clean", before the status call resolves', () => {
    // A promise that never settles — the widget must not assert anything yet.
    window.bezel = {
      ...window.bezel,
      git: { info: vi.fn().mockReturnValue(new Promise(() => {})) },
    } as typeof window.bezel
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    expect(screen.getByText('reading…')).toBeTruthy()
    expect(screen.queryByText('clean')).toBeNull()
  })

  it('says "unavailable", not "clean", when git could not be read', async () => {
    stubGitInfo(null)
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(screen.getByText('unavailable')).toBeTruthy())
    expect(screen.queryByText('clean')).toBeNull()
  })

  // The absence IS the answer now: a repo with nothing dirty renders no widget
  // at all, and the gutter drops the empty slot. "clean" was a permanent box
  // spending a row of gutter height to say nothing is happening.
  it('renders nothing at all for a repo that genuinely has no changes', async () => {
    stubGitInfo({ branch: 'main', ahead: 0, dirty: [] })
    const { container } = render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(container.querySelector('.widget')).toBeNull())
    expect(screen.queryByText('clean')).toBeNull()
  })

  it('renders nothing when the context has no root', () => {
    stubGitInfo({ branch: null, ahead: 0, dirty: [] })
    const { container } = render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={[]}>
        <ChangesWidget />
      </ContextProvider>
    )
    expect(container.querySelector('.widget')).toBeNull()
    expect(screen.queryByText('no repo')).toBeNull()
  })

  it('lists dirty files from a pinned context, outside orgs/', async () => {
    // The whole point of the sticky resolution: this widget was not modified,
    // and it lights up at ~/source purely because it is handed a root now.
    stubGitInfo({ branch: 'main', ahead: 0, dirty: ['a.txt'] })
    const { rerender } = render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    rerender(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(screen.getByText('a.txt')).toBeTruthy())
    expect(screen.queryByText('no repo')).toBeNull()
  })

  it('lists dirty files when under the display limit', async () => {
    stubGitInfo({ branch: 'main', ahead: 0, dirty: ['a.txt', 'b.txt'] })
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    await waitFor(() => {
      expect(screen.getByText('a.txt')).toBeTruthy()
      expect(screen.getByText('b.txt')).toBeTruthy()
    })
  })

  it('caps the list at 12 and shows a "+N more" row beyond that', async () => {
    const dirty = Array.from({ length: 15 }, (_, i) => `file-${i}.txt`)
    stubGitInfo({ branch: 'main', ahead: 0, dirty })
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <ChangesWidget />
      </ContextProvider>
    )
    await waitFor(() => {
      expect(screen.getByText('file-11.txt')).toBeTruthy()
      expect(screen.queryByText('file-12.txt')).toBeNull()
      expect(screen.getByText('+3 more')).toBeTruthy()
    })
  })
})

describe('SpecsWidget', () => {
  afterEach(() => { vi.restoreAllMocks() })

  const SPEC: SpecItem = {
    filename: '2026-07-31-bezel-design.md',
    title: 'bezel',
    kind: 'design',
    status: 'design',
    tldr: ['a', 'b'],
    htmlPath: 'repos/bezel/2026-07-31-bezel-design.html',
  }

  it('renders nothing when there is no recognized repo', () => {
    stubSpecsList([])
    const { container } = render(
      <ContextProvider cwd="C:/Users/testuser/source" activeId={1} repoRoots={[]}>
        <SpecsWidget />
      </ContextProvider>
    )
    expect(container.querySelector('.widget')).toBeNull()
  })

  it('shows "unavailable" when specs.list resolves null — distinct from an empty list', async () => {
    stubSpecsList(null)
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <SpecsWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(screen.getByText('unavailable')).toBeTruthy())
  })

  // Distinct from 'unavailable', which still renders: "this project has no
  // specs" is worth zero gutter height, "I could not ask" is worth saying.
  it('renders nothing when the project genuinely has no specs', async () => {
    stubSpecsList([])
    const { container } = render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <SpecsWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(container.querySelector('.widget')).toBeNull())
    expect(screen.queryByText('none')).toBeNull()
  })

  // Asks main to open it, rather than building a URL here: whether the generated
  // .html exists on this box is a filesystem question the renderer cannot answer.
  it('lists specs by title and asks main to open one on click', async () => {
    const { open } = stubSpecsList([SPEC])
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <SpecsWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(screen.getByText('bezel')).toBeTruthy())
    fireEvent.click(screen.getByText('bezel'))
    expect(open).toHaveBeenCalledWith(
      'devkit-inc',
      'repos/bezel/2026-07-31-bezel-design.html'
    )
  })

  // The kind used to be said twice on every row — once as the last word of the
  // title (it comes off the filename) and again as the status chip. Now it is a
  // glyph at the head of the row and nothing else.
  it('leads a row with the kind glyph and says the word only to a screen reader', async () => {
    const { open: _open } = stubSpecsList([SPEC])
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <SpecsWidget />
      </ContextProvider>
    )
    const row = await screen.findByRole('button', { name: /bezel/ })
    expect(row.textContent).toContain('🎨')
    // The status chip is dropped when it would only repeat the glyph.
    expect(screen.queryByText('· design')).toBeNull()
    // …but the word is still in the accessible name, because "artist palette"
    // is not what the emoji means here.
    expect(row).toHaveAccessibleName(expect.stringContaining('design'))
  })

  it('keeps the status chip when it says something the glyph does not', async () => {
    stubSpecsList([{ ...SPEC, status: 'shipped' }])
    render(
      <ContextProvider cwd={REPO_CWD} activeId={1} repoRoots={ROOTS}>
        <SpecsWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(screen.getByText('· shipped')).toBeTruthy())
  })

  it('queries specs.list with the last path segment of a nested repo as the project', async () => {
    const { list } = stubSpecsList([])
    render(
      <ContextProvider
        cwd="C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-scripts"
        activeId={1}
        repoRoots={['C:/Users/testuser/source/orgs/sbrain-inc/sbrain/sbrain-scripts']}
      >
        <SpecsWidget />
      </ContextProvider>
    )
    await waitFor(() => expect(list).toHaveBeenCalledWith('sbrain-inc', 'sbrain-scripts'))
  })
})
