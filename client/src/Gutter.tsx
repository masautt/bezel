import { Fragment, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { SLOT_MIN, type GutterSide, type SlotState, type WidgetId } from '@shared/layout'
import { Divider } from './Divider'
import { SlotContext } from './widgets/Widget'

export interface GutterProps {
  side: GutterSide
  slots: SlotState[]
  /**
   * The widget instances, by id. Passed in rather than constructed here because
   * SessionWidget needs the active tab's history, and a Gutter has no business
   * knowing that.
   */
  nodes: Partial<Record<WidgetId, ReactNode>>
  /** `seed` is the slot's measured fraction, used only while its height is still 'auto'. */
  onResize: (id: WidgetId, deltaRatio: number, seed: number) => void
  onToggle: (id: WidgetId) => void
  onReset: (id: WidgetId) => void
}

/**
 * One gutter: its slots in order, with a drag handle between each pair.
 *
 * Purely structural. It owns the flex basis of each slot (so a drag has a real
 * element to measure) and provides each widget its collapse state; it fetches
 * nothing and knows nothing about what any widget shows.
 */
export function Gutter({ side, slots, nodes, onResize, onToggle, onReset }: GutterProps) {
  const refs = useRef<Partial<Record<WidgetId, HTMLDivElement | null>>>({})

  // Measured at drag time, not render time: an 'auto' slot has no fraction of
  // its own, and seeding from its current pixel height is what stops the widget
  // jumping the instant it is grabbed.
  const seedOf = useCallback((id: WidgetId) => {
    const el = refs.current[id]
    const gutter = el?.closest<HTMLElement>('.gutter')
    const height = gutter?.clientHeight ?? 0
    return el && height ? el.clientHeight / height : SLOT_MIN
  }, [])

  // A hidden slot takes its grabber with it, so hiding the last-but-one widget
  // cannot leave a handle with nothing below it to trade against. Slots with no
  // node are skipped for the same reason rather than rendering an empty box.
  const visible = slots.filter(s => !s.hidden && nodes[s.id])

  return (
    <aside className={`gutter gutter-${side}`}>
      {visible.map((slot, index) => (
        <Fragment key={slot.id}>
          <div
            className={`slot${slot.collapsed ? ' collapsed' : ''}`}
            data-slot={slot.id}
            ref={el => { refs.current[slot.id] = el }}
            // A collapsed slot is header-only regardless of the height it would
            // claim when open, so it must not keep reserving a basis.
            style={
              typeof slot.height === 'number' && !slot.collapsed
                ? { flex: `0 0 ${(slot.height * 100).toFixed(2)}%` }
                : undefined
            }
          >
            <SlotContext.Provider
              value={{ collapsed: slot.collapsed, onToggleCollapse: () => onToggle(slot.id) }}
            >
              {nodes[slot.id]}
            </SlotContext.Provider>
          </div>
          {/* No grabber after the last slot: nothing below it to trade with. */}
          {index < visible.length - 1 && (
            <Divider
              measure={`.gutter-${side}`}
              onDrag={ratio => onResize(slot.id, ratio, seedOf(slot.id))}
              onReset={() => onReset(slot.id)}
            />
          )}
        </Fragment>
      ))}
    </aside>
  )
}
