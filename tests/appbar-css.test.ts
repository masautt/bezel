// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A guard on the two declarations the app bar's geometry hangs off, both of
 * which are invisible to every other test here: jsdom loads no stylesheet, so
 * nothing that renders TabStrip can observe them.
 *
 * They are guarded because they look removable and are not. `.ds-appbar` is
 * `align-items: center`, so anything it is handed is shrink-to-fit and floats in
 * the middle of the 32px bar — which reads as padding above and below the tabs,
 * and was the reported bug. `align-self: stretch` is the entire fix. A rounded
 * or bordered tab cannot touch the top edge either, by definition.
 */
const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8')

/** The numeric z-index a selector declares. Fails loudly if it declares none —
 *  an absent z-index is the failure mode these assertions exist to catch. */
function zIndex(selector: string): number {
  const found = /\n\s*z-index:\s*(-?\d+)\s*;/.exec(rule(selector))?.[1]
  expect(found, `no z-index on ${selector}`).toBeDefined()
  return Number(found)
}

/** The declaration block for a selector, without the braces. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('app bar geometry', () => {
  it('stretches the tab strip to the full bar height', () => {
    expect(rule('.tabstrip')).toMatch(/align-self:\s*stretch/)
    expect(rule('.tabstrip')).toMatch(/align-items:\s*stretch/)
  })

  it('keeps the tab itself square and flush, so it can meet the top edge', () => {
    const tab = rule('.tab')
    expect(tab).toMatch(/border:\s*none/)
    expect(tab).toMatch(/border-radius:\s*0/)
  })

  it('puts the active marker in a shadow, not a border that would cost a pixel', () => {
    expect(rule('.tab.on')).toMatch(/box-shadow:\s*inset/)
  })

  it('stretches the wordmark and the new-tab button alongside the tabs', () => {
    expect(rule('.appbar-brand')).toMatch(/align-self:\s*stretch/)
    expect(rule('.tab-new')).toMatch(/align-self:\s*stretch/)
  })

  // The launch screen covers the window for the whole ~8s startup. If it also
  // covers the bar, the window cannot be minimized, maximized or closed while
  // it is up — only dragged, since .loading-screen is itself a drag region.
  // These two numbers live in different rules and only mean anything relative
  // to each other, so neither rule can guard it alone.
  it('keeps the app bar above the launch screen, and positioned so it can be', () => {
    expect(zIndex('.ds-appbar')).toBeGreaterThan(zIndex('.loading-screen'))
    // A z-index on a static element is inert; react-ui leaves the bar static.
    expect(rule('.ds-appbar')).toMatch(/position:\s*relative/)
  })

  // Raising the bar over the launch screen moved it over the settings backdrop
  // too, which is `position: fixed` for the documented purpose of covering the
  // bar. Asserting the whole order rather than one pair: these are four numbers
  // in four rules, and each new layer is a chance to invert one of them.
  it('stacks the layers launch screen < app bar < settings', () => {
    // The panes are not in this list on purpose: .grid declares no z-index and
    // sits in normal flow, which is already below every positioned layer here.
    const order = ['.loading-screen', '.ds-appbar', '.settings-backdrop']
    const values = order.map(zIndex)
    expect(values, order.join(' < ')).toEqual([...values].sort((a, b) => a - b))
    expect(new Set(values).size, 'two layers share a z-index').toBe(values.length)
  })

  // -webkit-app-region is an OS-level declaration, not a paint one: a `drag`
  // area is titlebar as far as Windows is concerned, and the window manager
  // consumes clicks in it before the renderer sees them. On a fixed, inset:0
  // overlay that made the whole window titlebar for the entire launch, so the
  // window controls rendered normally and did nothing. No z-index can fix that.
  // App only sets the `launching` class; jsdom loads no stylesheet, so nothing
  // that renders App can observe that the class actually hides anything.
  it('hides the tab strip while the app is launching', () => {
    expect(rule('.app.launching .tabstrip')).toMatch(/display:\s*none/)
  })

  it('does not let the launch screen claim the window as a drag region', () => {
    expect(rule('.loading-screen')).toMatch(/-webkit-app-region:\s*no-drag\s*;/)
    // Anchored on the semicolon so this matches a DECLARATION and not the word
    // "drag" in the comment above it explaining why there isn't one.
    expect(rule('.loading-screen')).not.toMatch(/-webkit-app-region:\s*drag\s*;/)
  })

  it('keeps every app-bar control out of the drag region', () => {
    // The whole bar is `-webkit-app-region: drag` and react-ui exempts only its
    // own buttons: without this a click on the wordmark drags the window
    // instead of opening settings.
    expect(rule('.appbar-brand')).toMatch(/-webkit-app-region:\s*no-drag/)
    expect(rule('.tabstrip')).toMatch(/-webkit-app-region:\s*no-drag/)
  })

  // bezel's home zoom is 1.25 (registerZoom neutral in electron/main.ts), and
  // appbar.css divides by --ds-page-factor while multiplying by
  // --ds-zoom-neutral — so at home the two cancel and the 32px bar renders 25%
  // taller than every sibling app's. Pinning the numerator at 1 is what holds it
  // at 32px. If this override is dropped the bar silently grows again, and no
  // rendering test can see it: jsdom loads no stylesheet.
  it('holds the bar at its design height instead of riding the page zoom', () => {
    // Matched against the DECLARATION, not the whole block: the comment above it
    // names --ds-zoom-neutral to explain what is being overridden.
    const zoom = /\n\s*zoom:\s*([^;]+);/.exec(rule('.ds-appbar'))?.[1]
    expect(zoom, 'no zoom declaration on .ds-appbar').toBeDefined()
    expect(zoom).toMatch(/calc\(1\s*\/\s*var\(--ds-page-factor/)
    expect(zoom).not.toMatch(/--ds-zoom-neutral/)
  })

  // The tab is sized by its content between min- and max-width, so ANY padding
  // that appears on hover grows the tab (and shoves its neighbours) under the
  // pointer. The reserve has to be unconditional.
  it('reserves the close button\'s room on every tab, hovered or not', () => {
    expect(rule('.tab-label')).toMatch(/padding:\s*0 27px 0 12px/)
    expect(css).not.toMatch(/:hover .tab-label\s*{[^}]*padding-right/)
  })

  it('hides react-ui\'s own brand span, which App replaces with a button', () => {
    // Both must hold together: if the span comes back there are two wordmarks,
    // and if the bar keeps its left padding the button is no longer corner-flush.
    expect(rule('.ds-appbar-brand')).toMatch(/display:\s*none/)
    expect(rule('.ds-appbar')).toMatch(/padding-left:\s*0/)
  })
})
