import { useState } from 'react'
import { DEFAULT_PRESET_ID, activePreset, isDirty, type LayoutStore } from '@shared/presets'
import type { GutterSide, SlotState, WidgetId } from '@shared/layout'

export interface LayoutSectionProps {
  store: LayoutStore
  onApply(id: string): void
  onSaveAs(name: string): void
  onSaveToActive(): void
  onRename(id: string, name: string): void
  onDelete(id: string): void
  onToggleHidden(side: GutterSide, id: WidgetId, hidden: boolean): void
  onMove(side: GutterSide, id: WidgetId, delta: -1 | 1): void
  onResetLive(): void
}

const SIDES: Array<{ side: GutterSide; label: string }> = [
  { side: 'left', label: 'Left gutter' },
  { side: 'right', label: 'Right gutter' },
]

const WIDGET_LABELS: Record<WidgetId, string> = {
  context: 'Context',
  session: 'Session',
  specs: 'Specs',
  changes: 'Changes',
  window: 'Window',
  usage: 'Usage',
}

/**
 * Presets, plus widget order and visibility.
 *
 * All state comes in as props and every change goes out as a callback — the
 * pure reducers and the persistence both live in App. This section is the only
 * bezel-specific part of the settings dialog.
 *
 * Order is up/down buttons rather than drag-and-drop on purpose: dragging here
 * would be a second, differently-behaved pointer gesture in an app that already
 * has divider dragging, for a control used once in a while.
 */
export function LayoutSection(props: LayoutSectionProps) {
  const { store, onApply, onSaveAs, onSaveToActive, onRename, onDelete } = props
  const active = activePreset(store)
  const isBuiltIn = active.id === DEFAULT_PRESET_ID
  const dirty = isDirty(store)

  // An inline input rather than window.prompt, which blocks the renderer — the
  // same reason the Apps widget arms instead of calling window.confirm.
  const [draft, setDraft] = useState<{ mode: 'save-as' | 'rename'; value: string } | null>(null)

  const commit = () => {
    if (!draft) return
    if (draft.mode === 'save-as') onSaveAs(draft.value)
    else onRename(active.id, draft.value)
    setDraft(null)
  }

  const slotRow = (side: GutterSide, slot: SlotState, index: number, all: SlotState[]) => (
    <div className="settings-slot" key={slot.id}>
      <label className="settings-slot-label">
        <input
          type="checkbox"
          checked={!slot.hidden}
          onChange={e => props.onToggleHidden(side, slot.id, !e.target.checked)}
        />
        {WIDGET_LABELS[slot.id]}
      </label>
      <button
        type="button"
        aria-label={`Move ${WIDGET_LABELS[slot.id]} up`}
        disabled={index === 0}
        onClick={() => props.onMove(side, slot.id, -1)}
      >
        ▲
      </button>
      <button
        type="button"
        aria-label={`Move ${WIDGET_LABELS[slot.id]} down`}
        disabled={index === all.length - 1}
        onClick={() => props.onMove(side, slot.id, 1)}
      >
        ▼
      </button>
    </div>
  )

  return (
    <div className="settings-section">
      <div className="settings-row">
        <label htmlFor="preset-select">Preset</label>
        <select
          id="preset-select"
          value={active.id}
          onChange={e => onApply(e.target.value)}
        >
          {store.presets.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {/* The live layout is deliberately not the preset, so drift has to be
            visible or Save would look like it does nothing. */}
        {dirty && <span className="settings-dirty" data-testid="dirty">modified</span>}
      </div>

      <div className="settings-row">
        <button type="button" disabled={!dirty || isBuiltIn} onClick={onSaveToActive}>Save</button>
        <button type="button" onClick={() => setDraft({ mode: 'save-as', value: '' })}>Save as…</button>
        <button
          type="button"
          disabled={isBuiltIn}
          onClick={() => setDraft({ mode: 'rename', value: active.name })}
        >
          Rename
        </button>
        <button type="button" disabled={isBuiltIn} onClick={() => onDelete(active.id)}>Delete</button>
        <button type="button" onClick={props.onResetLive}>Reset layout</button>
      </div>

      {draft && (
        <div className="settings-row">
          <input
            autoFocus
            aria-label={draft.mode === 'save-as' ? 'New preset name' : 'Rename preset'}
            value={draft.value}
            onChange={e => setDraft({ ...draft, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { e.stopPropagation(); setDraft(null) }
            }}
          />
          <button type="button" onClick={commit}>OK</button>
          <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}

      {SIDES.map(({ side, label }) => (
        <div className="settings-group" key={side}>
          <h6>{label}</h6>
          {store.live.slots[side].map((slot, i, all) => slotRow(side, slot, i, all))}
        </div>
      ))}
    </div>
  )
}
