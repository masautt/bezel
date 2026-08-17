import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/**
 * Collapse state for one gutter slot, supplied by `<Gutter>`.
 *
 * Delivered by context rather than props so the five widget components stay
 * unchanged: each keeps rendering `<Widget title="Apps">` and knows nothing
 * about layout. Sizing is deliberately NOT here — the flex basis lives on the
 * `.slot` wrapper Gutter renders, which is also the element it measures when
 * seeding a drag on an as-yet-unsized widget.
 */
export interface SlotControls {
  collapsed: boolean
  onToggleCollapse: () => void
}

export const SlotContext = createContext<SlotControls | null>(null)

export interface WidgetProps {
  title: string
  children: ReactNode
  /** Overridden by a SlotContext when one is present. */
  collapsed?: boolean
  /** Omit (and provide no SlotContext) to leave the header inert. */
  onToggleCollapse?: () => void
  /** Rendered right-aligned in the header row. The Apps view switcher lives
   *  here rather than costing a full row of its own. */
  headerRight?: ReactNode
}

export function Widget({
  title,
  children,
  collapsed: collapsedProp = false,
  onToggleCollapse: onToggleProp,
  headerRight,
}: WidgetProps) {
  const slot = useContext(SlotContext)
  const collapsed = slot?.collapsed ?? collapsedProp
  const onToggleCollapse = slot?.onToggleCollapse ?? onToggleProp

  return (
    <section className={`widget${collapsed ? ' collapsed' : ''}`}>
      <div className="widget-head">
        {onToggleCollapse ? (
          <button
            type="button"
            className="widget-title"
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            {title}
          </button>
        ) : (
          <h5 className="widget-title">{title}</h5>
        )}
        {/* Without stopPropagation the header's own collapse handler fires on
            every interaction with a control hosted here. */}
        {headerRight && (
          <div className="widget-head-right" onClick={e => e.stopPropagation()}>{headerRight}</div>
        )}
      </div>
      {!collapsed && <div className="widget-body">{children}</div>}
    </section>
  )
}
