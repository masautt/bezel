import { describe, it, expect } from 'vitest'
import {
  paneKey, parsePaneKey, cleanTitle, createInitialTabs, createTab, closeTab,
  activateTab, activateNext, activatePrev, activateIndex,
  setTabCwd, setTabTitle, armClose, disarmAll, tabLabel, MAX_HISTORY,
  markAttention, clearAttention, recordSessionId,
  type TabsState,
} from '../src/tabs'

const ROOT = 'C:/Users/testuser/source'

/** Three tabs, ids 1/2/3, tab 1 active. */
function three(): TabsState {
  let s = createInitialTabs(ROOT)
  s = createTab(s, ROOT)
  s = createTab(s, ROOT)
  return activateTab(s, 1)
}

describe('paneKey / parsePaneKey', () => {
  it('round-trips a tab id and role', () => {
    expect(paneKey(7, 'claude')).toBe('7:claude')
    expect(parsePaneKey('7:claude')).toEqual({ tabId: 7, role: 'claude' })
    expect(parsePaneKey(paneKey(12, 'shell'))).toEqual({ tabId: 12, role: 'shell' })
  })

  it('rejects malformed keys instead of guessing', () => {
    expect(parsePaneKey('claude')).toBeNull()
    expect(parsePaneKey('1:bash')).toBeNull()
    expect(parsePaneKey('x:shell')).toBeNull()
    expect(parsePaneKey('1:shell:2')).toBeNull()
    expect(parsePaneKey('')).toBeNull()
  })
})

describe('createInitialTabs', () => {
  it('opens exactly one active tab at the given cwd', () => {
    const s = createInitialTabs('C:/tmp')
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].cwd).toBe('C:/tmp')
    expect(s.tabs[0].history).toEqual([])
    expect(s.tabs[0].closeArmed).toBe(false)
    expect(s.activeId).toBe(s.tabs[0].id)
  })
})

describe('createTab', () => {
  it('appends to the right of the last tab and activates it', () => {
    const s = createTab(createInitialTabs(ROOT), 'C:/other')
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs[1].cwd).toBe('C:/other')
    expect(s.activeId).toBe(s.tabs[1].id)
  })

  it('never reuses an id, even after a close', () => {
    let s = three()
    const idsBefore = s.tabs.map(t => t.id)
    s = closeTab(s, idsBefore[2])
    s = createTab(s, ROOT)
    const created = s.tabs[s.tabs.length - 1].id
    expect(idsBefore).not.toContain(created)
  })
})

describe('closeTab', () => {
  it('activates the neighbor to the right when closing the active tab', () => {
    const s = closeTab(activateTab(three(), 2), 2)
    expect(s.tabs.map(t => t.id)).toEqual([1, 3])
    expect(s.activeId).toBe(3)
  })

  it('falls back to the left neighbor when closing the last tab', () => {
    const s = closeTab(activateTab(three(), 3), 3)
    expect(s.tabs.map(t => t.id)).toEqual([1, 2])
    expect(s.activeId).toBe(2)
  })

  it('leaves the active tab alone when closing a different one', () => {
    const s = closeTab(activateTab(three(), 1), 3)
    expect(s.activeId).toBe(1)
  })

  it('refuses to close the only tab', () => {
    const s = createInitialTabs(ROOT)
    expect(closeTab(s, s.activeId)).toBe(s)
  })

  it('ignores an unknown id', () => {
    const s = three()
    expect(closeTab(s, 999)).toBe(s)
  })
})

describe('activation', () => {
  it('wraps forward and backward', () => {
    let s = activateTab(three(), 3)
    expect(activateNext(s).activeId).toBe(1)
    s = activateTab(s, 1)
    expect(activatePrev(s).activeId).toBe(3)
  })

  it('activates by zero-based index and ignores out-of-range', () => {
    const s = three()
    expect(activateIndex(s, 1).activeId).toBe(2)
    expect(activateIndex(s, 9)).toBe(s)
    expect(activateIndex(s, -1)).toBe(s)
  })

  it('ignores an unknown id', () => {
    const s = three()
    expect(activateTab(s, 999)).toBe(s)
  })
})

describe('cleanTitle', () => {
  it('strips the animated spinner prefix so repeated frames collapse', () => {
    // Verbatim from the Task 1 probe against a real claude session.
    expect(cleanTitle('⠂ Reply with the word hello')).toBe('Reply with the word hello')
    expect(cleanTitle('⠐ Reply with the word hello')).toBe('Reply with the word hello')
    expect(cleanTitle('✳ Reply with the word hello')).toBe('Reply with the word hello')
    expect(cleanTitle('  ✳  Adding tabs to bezel  ')).toBe('Adding tabs to bezel')
  })

  it('keeps a title that has no prefix', () => {
    expect(cleanTitle('Adding tabs to bezel')).toBe('Adding tabs to bezel')
  })

  it('rejects the shell reporting its own executable', () => {
    expect(cleanTitle('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeNull()
    expect(cleanTitle('pwsh.exe')).toBeNull()
    expect(cleanTitle('C:/Users/testuser/source')).toBeNull()
  })

  it('rejects generic placeholders that say less than the repo name', () => {
    expect(cleanTitle('claude')).toBeNull()
    expect(cleanTitle('✳ Claude Code')).toBeNull()
    expect(cleanTitle('CLAUDE')).toBeNull()
  })

  it('rejects empty and glyph-only titles', () => {
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('   ')).toBeNull()
    expect(cleanTitle('⠂')).toBeNull()
  })
})

describe('cwd and title', () => {
  it('updates one tab only', () => {
    let s = setTabCwd(three(), 2, 'C:/moved')
    s = setTabTitle(s, 2, 'Adding tabs')
    expect(s.tabs.find(t => t.id === 2)).toMatchObject({ cwd: 'C:/moved', history: ['Adding tabs'] })
    expect(s.tabs.find(t => t.id === 1)).toMatchObject({ cwd: ROOT, history: [] })
  })

  it('cleans the title on the way in', () => {
    const s = setTabTitle(three(), 2, '⠂ Adding tabs to bezel')
    expect(s.tabs.find(t => t.id === 2)!.history[0]).toBe('Adding tabs to bezel')
  })

  it('returns the SAME state for a repeated spinner frame', () => {
    // This reference equality is what stops the spinner — which re-fires the
    // title several times a second — from re-rendering every tab's layer.
    const s = setTabTitle(three(), 2, '⠂ Adding tabs to bezel')
    expect(setTabTitle(s, 2, '⠐ Adding tabs to bezel')).toBe(s)
    expect(setTabTitle(s, 2, '✳ Adding tabs to bezel')).toBe(s)
  })

  it('returns the SAME state for a rejected title, keeping the fallback', () => {
    const s = three()
    expect(setTabTitle(s, 2, 'pwsh.exe')).toBe(s)
    expect(setTabTitle(s, 2, 'Claude Code')).toBe(s)
    expect(setTabTitle(s, 2, '   ')).toBe(s)
  })

  it('ignores updates for an unknown id', () => {
    const s = three()
    expect(setTabCwd(s, 999, 'C:/x')).toBe(s)
    expect(setTabTitle(s, 999, 'x')).toBe(s)
  })

  it('returns the SAME state when the cwd is unchanged', () => {
    // OSC 7 fires on every prompt whether or not the directory actually
    // changed — this reference equality is what stops every prompt from
    // re-rendering every tab's layer, matching setTabTitle's no-op contract.
    const s = three()
    expect(setTabCwd(s, 1, ROOT)).toBe(s)
    const moved = setTabCwd(s, 2, 'C:/moved')
    expect(setTabCwd(moved, 2, 'C:/moved')).toBe(moved)
  })
})

describe('two-step close arming', () => {
  it('arms one tab at a time', () => {
    let s = armClose(three(), 2)
    expect(s.tabs.find(t => t.id === 2)!.closeArmed).toBe(true)
    s = armClose(s, 3)
    expect(s.tabs.find(t => t.id === 2)!.closeArmed).toBe(false)
    expect(s.tabs.find(t => t.id === 3)!.closeArmed).toBe(true)
  })

  it('arms the only tab too — closing the last tab quits, it does not stay unreachable', () => {
    const s = createInitialTabs(ROOT)
    expect(armClose(s, s.activeId).tabs.find(t => t.id === s.activeId)!.closeArmed).toBe(true)
  })

  it('disarms everything when the active tab changes', () => {
    const armed = armClose(three(), 2)
    expect(activateTab(armed, 3).tabs.every(t => !t.closeArmed)).toBe(true)
    expect(activateNext(armed).tabs.every(t => !t.closeArmed)).toBe(true)
    expect(createTab(armed, ROOT).tabs.every(t => !t.closeArmed)).toBe(true)
  })

  it('disarmAll is a no-op when nothing is armed', () => {
    const s = three()
    expect(disarmAll(s)).toBe(s)
  })

  it('armClose is a no-op (same reference) when the tab is already armed', () => {
    const s = armClose(three(), 2)
    expect(armClose(s, 2)).toBe(s)
  })
})

describe('tabLabel', () => {
  const base = { id: 1, cwd: ROOT, closeArmed: false, attention: false }

  it('prefers the reported title', () => {
    expect(tabLabel({ ...base, history: ['Adding tabs to bezel'] }, 'bezel', 'devkit-inc'))
      .toBe('Adding tabs to bezel')
  })

  it('falls back to repo, then org, then source', () => {
    expect(tabLabel({ ...base, history: [] }, 'bezel', 'devkit-inc')).toBe('bezel')
    expect(tabLabel({ ...base, history: [] }, null, 'devkit-inc')).toBe('devkit-inc')
    expect(tabLabel({ ...base, history: [] }, null, null)).toBe('source')
  })

  it('treats a blank or whitespace title as absent', () => {
    expect(tabLabel({ ...base, history: ['   '] }, 'bezel', null)).toBe('bezel')
    expect(tabLabel({ ...base, history: [''] }, null, null)).toBe('source')
  })
})

describe('session history', () => {
  it('starts empty on a new tab', () => {
    const s = createInitialTabs(ROOT)
    expect(s.tabs[0].history).toEqual([])
    expect(createTab(s, ROOT).tabs[1].history).toEqual([])
  })

  it('unshifts each new summary, newest first', () => {
    let s = createInitialTabs(ROOT)
    s = setTabTitle(s, 1, 'Adding tabs to bezel')
    s = setTabTitle(s, 1, 'Fixing the close button')
    expect(s.tabs[0].history).toEqual(['Fixing the close button', 'Adding tabs to bezel'])
  })

  it('does not record a repeated spinner frame', () => {
    let s = setTabTitle(createInitialTabs(ROOT), 1, '⠂ Adding tabs')
    const before = s
    s = setTabTitle(s, 1, '⠐ Adding tabs')
    expect(s).toBe(before)
    expect(s.tabs[0].history).toEqual(['Adding tabs'])
  })

  it('does not record a rejected title', () => {
    const s = createInitialTabs(ROOT)
    expect(setTabTitle(s, 1, 'pwsh.exe')).toBe(s)
    expect(setTabTitle(s, 1, 'Claude Code')).toBe(s)
    expect(s.tabs[0].history).toEqual([])
  })

  it('records a summary that returns after a different one', () => {
    // Only the CURRENT entry is deduped, not the whole list — going back to an
    // earlier task is a real event worth showing.
    let s = createInitialTabs(ROOT)
    s = setTabTitle(s, 1, 'Task A')
    s = setTabTitle(s, 1, 'Task B')
    s = setTabTitle(s, 1, 'Task A')
    expect(s.tabs[0].history).toEqual(['Task A', 'Task B', 'Task A'])
  })

  it('caps the list, dropping the oldest', () => {
    let s = createInitialTabs(ROOT)
    for (let i = 1; i <= MAX_HISTORY + 3; i += 1) s = setTabTitle(s, 1, `Task ${i}`)
    const history = s.tabs[0].history
    expect(history).toHaveLength(MAX_HISTORY)
    expect(history[0]).toBe(`Task ${MAX_HISTORY + 3}`)
    expect(history[history.length - 1]).toBe('Task 4')
  })

  it("keeps each tab's history independent", () => {
    let s = createTab(createInitialTabs(ROOT), ROOT)
    s = setTabTitle(s, 1, 'On tab one')
    s = setTabTitle(s, 2, 'On tab two')
    expect(s.tabs.find(t => t.id === 1)!.history).toEqual(['On tab one'])
    expect(s.tabs.find(t => t.id === 2)!.history).toEqual(['On tab two'])
  })
})

describe('tabLabel with history', () => {
  const base = { id: 1, cwd: ROOT, closeArmed: false, attention: false }

  it('uses the newest summary', () => {
    expect(tabLabel({ ...base, history: ['Newest', 'Older'] }, 'bezel', 'devkit-inc')).toBe('Newest')
  })

  it('falls back through repo, org, then source on an empty history', () => {
    expect(tabLabel({ ...base, history: [] }, 'bezel', 'devkit-inc')).toBe('bezel')
    expect(tabLabel({ ...base, history: [] }, null, 'devkit-inc')).toBe('devkit-inc')
    expect(tabLabel({ ...base, history: [] }, null, null)).toBe('source')
  })
})

describe('markAttention / clearAttention', () => {
  it('marks a tab that rang the bell', () => {
    const s = markAttention(three(), 2)
    expect(s.tabs.find(t => t.id === 2)!.attention).toBe(true)
    expect(s.tabs.find(t => t.id === 1)!.attention).toBe(false)
  })

  it('is idempotent, so a chatty session does not re-render every layer', () => {
    const s = markAttention(three(), 2)
    expect(markAttention(s, 2)).toBe(s)
  })

  it('ignores a tab that is not there', () => {
    const s = three()
    expect(markAttention(s, 99)).toBe(s)
  })

  it('clears without switching, for the window regaining focus', () => {
    const s = clearAttention(markAttention(three(), 1), 1)
    expect(s.tabs.find(t => t.id === 1)!.attention).toBe(false)
    expect(s.activeId).toBe(1)
  })

  it('clears only the named tab', () => {
    let s = markAttention(three(), 2)
    s = markAttention(s, 3)
    s = clearAttention(s, 2)
    expect(s.tabs.find(t => t.id === 2)!.attention).toBe(false)
    expect(s.tabs.find(t => t.id === 3)!.attention).toBe(true)
  })

  it('is a no-op on an unmarked tab', () => {
    const s = three()
    expect(clearAttention(s, 1)).toBe(s)
    expect(clearAttention(s, 99)).toBe(s)
  })

  it('survives arming a close — two independent states on the same tab', () => {
    const s = armClose(markAttention(three(), 2), 2)
    const tab = s.tabs.find(t => t.id === 2)!
    expect(tab.attention).toBe(true)
    expect(tab.closeArmed).toBe(true)
  })
})

describe('activating a tab answers its bell', () => {
  it('clears the mark on the tab switched to', () => {
    const s = activateTab(markAttention(three(), 2), 2)
    expect(s.tabs.find(t => t.id === 2)!.attention).toBe(false)
  })

  it('leaves other marked tabs alone', () => {
    let s = markAttention(three(), 2)
    s = markAttention(s, 3)
    s = activateTab(s, 2)
    expect(s.tabs.find(t => t.id === 3)!.attention).toBe(true)
  })

  it('clears through every route in, not just a click', () => {
    // activateNext/Prev/Index all funnel through activateTab; this is the
    // guarantee that keeps the clearing in one place.
    expect(activateNext(markAttention(three(), 2)).tabs.find(t => t.id === 2)!.attention).toBe(false)
    expect(activatePrev(markAttention(three(), 3)).tabs.find(t => t.id === 3)!.attention).toBe(false)
    expect(activateIndex(markAttention(three(), 3), 2).tabs.find(t => t.id === 3)!.attention).toBe(false)
  })

  it('clears a mark on the ALREADY-active tab rather than short-circuiting', () => {
    const s = markAttention(three(), 1)
    expect(activateTab(s, 1).tabs.find(t => t.id === 1)!.attention).toBe(false)
  })

  it('still returns the same state when there is nothing at all to change', () => {
    const s = three()
    expect(activateTab(s, 1)).toBe(s)
  })
})

describe('recordSessionId', () => {
  it('records the uuid a tab claude pty was actually spawned with', () => {
    const s = recordSessionId(three(), 2, 'uuid-a')
    expect(s.tabs.find(t => t.id === 2)!.claudeSessionId).toBe('uuid-a')
    expect(s.tabs.find(t => t.id === 1)!.claudeSessionId).toBeUndefined()
  })

  it('is a no-op — same reference — when the id already matches, so a resume ack does not re-render every layer', () => {
    const s = recordSessionId(three(), 1, 'uuid-a')
    expect(recordSessionId(s, 1, 'uuid-a')).toBe(s)
  })

  it('ignores a tab that is not there', () => {
    const s = three()
    expect(recordSessionId(s, 99, 'uuid-a')).toBe(s)
  })
})
