import { useState } from 'react'
import { useFullscreen } from '@devkit-inc/react-ui'
import type { ThemeDef, ThemeRegistry, ThemeType } from '@devkit-inc/react-ui'
import { ExpandGlyph } from '../../icons'
import { chimeEnabled, setChimeEnabled, playChime } from '../../chime'

/** A 14px preview of a theme's own background, border and accent. */
function Swatch({ theme }: { theme: ThemeDef }) {
  const dark = theme.type === 'dark'
  const bg = theme.colors['--ds-bg'] ?? (dark ? '#0d1117' : '#ffffff')
  const accent = theme.colors['--ds-accent'] ?? (dark ? '#58a6ff' : '#0969da')
  const border = theme.colors['--ds-border'] ?? (dark ? '#30363d' : '#d1d9e0')
  // `ds-theme-swatch` is react-ui's own class, from the appbar.css this app
  // already loads. Reused rather than restyled: it is the same 14px preview the
  // shell draws, and a second copy of the geometry is a second thing to drift.
  return (
    <span className="ds-theme-swatch" style={{ background: bg, borderColor: border }}>
      <span style={{ background: accent }} />
    </span>
  )
}

const GROUPS: { type: ThemeType; label: string }[] = [
  { type: 'dark', label: 'Dark' },
  { type: 'light', label: 'Light' },
]

export interface AppearanceSectionProps {
  /**
   * Owned by App, not by this section.
   *
   * The theme has to be applied on startup, and `SettingsSection.render` is
   * called only while its section is the visible one — a registry created here
   * would exist only for as long as this panel is open, so the app would launch
   * unthemed and revert the moment the dialog closed.
   */
  registry: ThemeRegistry
}

/**
 * Theme, and the window's full-screen state.
 *
 * This is now the ONLY theme picker in the app: the app bar's ⋯ menu — which
 * used to carry both this and the Full screen row — is gone, replaced by the
 * gear beside the tabs. Everything that menu offered lives here.
 *
 * Note what this replaced: a light/dark button on `useDocumentTheme`, which
 * writes `data-theme` on <html> and nothing else. That stopped working when the
 * theme registry arrived — the registry writes the resolved `--ds-*` tokens to
 * <html>'s INLINE style, which outranks every `[data-theme='light']` rule in
 * every stylesheet, so flipping the attribute underneath repainted nothing.
 * Driving the same registry the shell drives is what makes this button real.
 */
export function AppearanceSection({ registry }: AppearanceSectionProps) {
  const { themes, theme, select, loading } = registry
  // Mounted and unmounted with this panel, which is fine: it seeds from
  // `isFullscreen()` on mount, so it is never stale on the way in. The registry
  // above cannot work that way — see the prop's note.
  const fullscreen = useFullscreen(window.bezel)
  const fullscreenApi = window.bezel.fullscreen
  // Seeded once from storage, which is the only writer besides this row —
  // there is no cross-machine sync for it on purpose (see chime.ts).
  const [chime, setChime] = useState(chimeEnabled)

  return (
    <div className="settings-section">
      <div className="settings-group">
        <h6>Theme</h6>
        {/* ONE radiogroup spanning both lists, not one per list: light and dark
            are two halves of a single exclusive choice, and a radiogroup each
            would announce them as two independent settings. The Dark/Light
            headings inside are plain labels — grouped visually, as VSCode's
            picker does, so the light↔dark split is legible in the layout. */}
        <div className="theme-list" role="radiogroup" aria-label="Theme">
          {GROUPS.map(group => {
            const inGroup = themes.filter(t => t.type === group.type)
            if (inGroup.length === 0) return null
            return (
              <div key={group.type}>
                <div className="theme-group">{group.label}</div>
                {inGroup.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-row${t.id === theme.id ? ' on' : ''}`}
                    // `aria-checked` is what says which one is live — the accent
                    // color alone tells a screen reader nothing.
                    role="radio"
                    aria-checked={t.id === theme.id}
                    onClick={() => select(t.id)}
                  >
                    <Swatch theme={t} />
                    <span className="theme-label">{t.label}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
        {/* The built-ins render immediately and the remote library folds in
            behind them, so this is a footnote rather than a spinner in place of
            the list — there is never a moment with nothing to pick. */}
        {loading && <p className="settings-hint">Loading the shared theme library…</p>}
      </div>

      <p className="settings-hint">
        One choice per user, not per app: picking here moves masaudit, localhub and
        sbrain-desktop too.
      </p>

      <div className="settings-group">
        <h6>Notifications</h6>
        <div className="settings-row">
          <button
            type="button"
            className={chime ? 'on' : undefined}
            aria-pressed={chime}
            onClick={() => {
              const next = !chime
              setChime(next)
              setChimeEnabled(next)
              // Turning it ON plays it once. A sound you cannot hear before
              // committing to it is a setting you have to test by waiting for a
              // build to finish, and the volume is the whole question here.
              if (next) playChime()
            }}
          >
            {chime ? 'Chime is on' : 'Chime is off'}
          </button>
          <span className="settings-hint">
            A short tone when a session rings the bell — claude finishing a turn, a
            command wanting an answer. Only for a tab you are not watching; the tab
            itself pulses either way. This machine only.
          </span>
        </div>
      </div>

      {/* Only when the shell can actually do it — an app on an older
          @devkit-inc/electron-ui has no `fullscreen` on its bridge, and a button
          that silently does nothing is worse than no button. */}
      {fullscreenApi && (
        <div className="settings-group">
          <h6>Window</h6>
          <div className="settings-row">
            <button
              type="button"
              className={fullscreen ? 'on' : undefined}
              title="F11"
              aria-keyshortcuts="F11"
              aria-pressed={fullscreen}
              onClick={() => fullscreenApi.toggle()}
            >
              <ExpandGlyph />
              {fullscreen ? 'Leave full screen' : 'Full screen'}
            </button>
            {/* The row exists mostly to name the key: F11 is the thing you will
                actually use, and a shortcut nothing ever mentions is one nobody
                finds. */}
            <span className="settings-hint">F11</span>
          </div>
        </div>
      )}
    </div>
  )
}
