import { describe, it, expect } from 'vitest'
import { parseTabs, toPersisted, createInitialTabs, MAX_HISTORY } from '../src/tabs.js'

const valid = {
  tabs: [
    { id: 3, cwd: 'C:\\src\\a', claudeSessionId: 'aaaaaaaa-1111-4222-8333-444444444444', history: ['fix the parser'] },
    { id: 5, cwd: 'C:\\src\\b', history: [] },
  ],
  activeId: 5,
  nextId: 6,
}

describe('parseTabs', () => {
  it('round-trips a valid persisted set', () => {
    const state = parseTabs(valid)!
    expect(state.tabs.map(t => t.id)).toEqual([3, 5])
    expect(state.activeId).toBe(5)
    expect(state.nextId).toBe(6)
    expect(state.tabs[0].claudeSessionId).toBe('aaaaaaaa-1111-4222-8333-444444444444')
  })

  it('parses a JSON string as well as an object', () => {
    expect(parseTabs(JSON.stringify(valid))!.tabs).toHaveLength(2)
  })

  it('restores transient flags to false rather than trusting the file', () => {
    const state = parseTabs({ ...valid, tabs: [{ ...valid.tabs[0], closeArmed: true, attention: true }] })!
    expect(state.tabs[0].closeArmed).toBe(false)
    expect(state.tabs[0].attention).toBe(false)
  })

  it('drops one bad entry rather than the whole set', () => {
    const state = parseTabs({ ...valid, tabs: [valid.tabs[0], { id: 'nope', cwd: 7 }] })!
    expect(state.tabs.map(t => t.id)).toEqual([3])
  })

  it('drops duplicate ids, keeping the first', () => {
    const dupe = { id: 3, cwd: 'C:\\src\\other', history: [] }
    const state = parseTabs({ ...valid, tabs: [valid.tabs[0], dupe] })!
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].cwd).toBe('C:\\src\\a')
  })

  it('falls back to the first tab when activeId names no surviving tab', () => {
    expect(parseTabs({ ...valid, activeId: 99 })!.activeId).toBe(3)
  })

  it('repairs a nextId that would recycle a live id', () => {
    // A recycled id lets a late pty:data from a closed tab land on a new one.
    expect(parseTabs({ ...valid, nextId: 4 })!.nextId).toBe(6)
    expect(parseTabs({ ...valid, nextId: 'x' })!.nextId).toBe(6)
  })

  it('caps history at MAX_HISTORY and keeps only strings', () => {
    const long = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => `s${i}`)
    const state = parseTabs({ ...valid, tabs: [{ ...valid.tabs[0], history: [...long, 42] }] })!
    expect(state.tabs[0].history).toHaveLength(MAX_HISTORY)
    expect(state.tabs[0].history[0]).toBe('s0')
  })

  it('drops a claudeSessionId that is not a uuid, keeping the tab', () => {
    // The spawn side already refuses to splice a non-uuid into the PowerShell
    // command line (`sessionFlag`), so a bogus id produces NO `--resume` flag
    // and claude starts a brand-new conversation — while the renderer is told
    // the pane is resuming and re-records the bogus id straight back to disk.
    // The tab is then poisoned forever. Refusing the id here is what turns
    // that into an honest `{ mode: 'new' }` with a real, recordable uuid.
    const bad = ['not-a-uuid', '', '   ', '../../etc/passwd', 'aaaaaaaa-1111-4222-8333-44444444444', '"; rm -rf / ;"']
    for (const claudeSessionId of bad) {
      const state = parseTabs({ ...valid, tabs: [{ ...valid.tabs[0], claudeSessionId }] })!
      expect(state.tabs).toHaveLength(1)
      expect(state.tabs[0].id).toBe(3)
      expect(state.tabs[0].claudeSessionId).toBeUndefined()
    }
  })

  it('does not let a corrupt session id survive a round trip back to disk', () => {
    const state = parseTabs({ ...valid, tabs: [{ ...valid.tabs[0], claudeSessionId: 'uuid-a' }] })!
    expect(toPersisted(state).tabs[0]).not.toHaveProperty('claudeSessionId')
  })

  it('returns null for junk and for an empty set', () => {
    expect(parseTabs(null)).toBeNull()
    expect(parseTabs('not json')).toBeNull()
    expect(parseTabs({ tabs: [] })).toBeNull()
    expect(parseTabs({ tabs: 'nope' })).toBeNull()
  })
})

describe('toPersisted', () => {
  it('drops transient flags and keeps identity', () => {
    const state = createInitialTabs('C:\\src\\a')
    const out = toPersisted({ ...state, tabs: [{ ...state.tabs[0], attention: true, closeArmed: true, claudeSessionId: 'u1' }] })
    expect(out.tabs[0]).toEqual({ id: 1, cwd: 'C:\\src\\a', claudeSessionId: 'u1', history: [] })
    expect(out.nextId).toBe(2)
  })

  it('survives a parseTabs round trip', () => {
    const state = createInitialTabs('C:\\src\\a')
    expect(parseTabs(toPersisted(state))!.tabs[0].id).toBe(state.tabs[0].id)
  })
})
