import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * One pane of the settings dialog.
 *
 * `render` is a function rather than a `ReactNode` so a section's body is built
 * only while it is the visible one — a section that fetches or subscribes does
 * not do so from behind another tab.
 */
export interface SettingsSection {
  id: string
  label: string
  /**
   * Optional mark shown left of the label in the nav. Optional so the shell
   * stays as generic as `render` makes it — a section list with no icons is
   * still a valid one, and the nav simply renders text.
   *
   * Rendered inside the tab BUTTON, so it must be `aria-hidden`: the label is
   * the accessible name, and an unlabeled <svg> in there would append nothing
   * useful to it at best and a stray "image" at worst.
   */
  icon?: ReactNode
  render(): ReactNode
}

export interface SettingsModalProps {
  open: boolean
  sections: SettingsSection[]
  onClose(): void
}

/**
 * The generic settings shell: overlay, section nav, focus handling.
 *
 * Deliberately knows NOTHING about bezel — no layout, no presets, no bridge. It
 * takes a list of sections and renders them. That is the whole extraction
 * boundary: when this moves into @devkit-inc/react-ui, only this file goes, and
 * every app keeps passing its own sections.
 *
 * Mounted as a SIBLING of the app grid, never a wrapper. Wrapping the grid — or
 * gating an ancestor on `open` — would unmount every tab layer, dispose each
 * TerminalPane and orphan its pty. Opening a settings dialog must not be able to
 * kill a running Claude session.
 */
export function SettingsModal({ open, sections, onClose }: SettingsModalProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')
  const dialog = useRef<HTMLDivElement>(null)
  // Whatever had focus when the dialog opened, so it can be handed back.
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    // Focus the dialog itself rather than its first control: the section nav is
    // a tablist, and landing on a tab would read as "you are editing this".
    dialog.current?.focus()
    return () => {
      // A pane very likely had focus before this opened, and handing it back is
      // what stops the next keystroke going nowhere.
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [open])

  // Reset to the first section between openings, so the dialog always opens
  // showing the same thing rather than wherever it was left weeks ago.
  useEffect(() => { if (open) setActiveId(sections[0]?.id ?? '') }, [open, sections])

  if (!open) return null

  const active = sections.find(s => s.id === activeId) ?? sections[0]

  // Bound on the dialog rather than on `window`: every terminal pane forwards
  // keystrokes to a live pty, and a window-level Escape handler would fire for
  // keys typed into a shell that merely happens to be behind this.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    // Focus must not escape into the panes behind — a Tab that lands in a
    // terminal types into a shell the user cannot see.
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      e.preventDefault()
      last.focus()
    }
  }

  return (
    <div className="settings-backdrop" data-testid="settings-backdrop" onClick={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={onKeyDown}
        // The backdrop closes on click; the dialog must not inherit that.
        onClick={e => e.stopPropagation()}
      >
        <div className="settings-nav" role="tablist" aria-label="Settings sections">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === active?.id}
              className={`settings-nav-item${s.id === active?.id ? ' on' : ''}`}
              onClick={() => setActiveId(s.id)}
            >
              {/* The column is reserved whether or not this section supplied an
                  icon, so a mixed list keeps every label on the same x — the
                  same reason react-ui's overflow menu reserves its icon slot. */}
              <span className="settings-nav-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-panel">{active?.render()}</div>
        <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  )
}
