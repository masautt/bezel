// @vitest-environment node
//
// Forced to `node`: under the repo's default jsdom environment `import.meta.url` is an
// http URL, and every read below fails with "The URL must be of scheme file".
//
// The main process can't be imported under vitest (it calls app.whenReady() on load and
// pulls in node-pty's native binding), so this reads the source instead. Blunt, but it is
// the only automated thing standing between "bezel opens at 125%" and a silent revert to
// the fleet default — the visible symptom of which is one notch of font size that nobody
// files a bug about.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoRoot = new URL('..', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, repoRoot), 'utf8')

describe('bezel zoom neutral', () => {
  it('opens at 125%, not the fleet-wide 100%', () => {
    expect(read('electron/main.ts')).toMatch(/registerZoom\(win,\s*\{\s*app,\s*neutral:\s*1\.25\s*\}\)/)
  })

  // `neutral` only exists in @devkit-inc/electron-ui 2.5.0+; on 2.4.x it is silently
  // ignored (an unknown option on a plain object) and bezel drops back to 100% with no
  // error anywhere. Same for the renderer half in @devkit-inc/react-ui 1.18.0+, which is
  // what hides the zoom indicator at 125% instead of parking it on screen forever.
  // A floor, not an exact pin: this asserts the range is new ENOUGH, so an unrelated
  // shared-package bump does not fail a test about zoom neutral.
  it('depends on shells new enough to honor a per-app neutral', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    const atLeast = (range: string, min: string) => {
      const parts = (s: string) => s.replace(/^\D*/, '').split('.').map(Number)
      const [a, b, c] = parts(range)
      const [x, y, z] = parts(min)
      return a !== x ? a > x : b !== y ? b > y : c >= z
    }
    expect(atLeast(pkg.dependencies['@devkit-inc/electron-ui'], '2.5.0')).toBe(true)
    expect(atLeast(pkg.dependencies['@devkit-inc/react-ui'], '1.18.0')).toBe(true)
  })

  it('resolves those ranges to installed copies that actually have the feature', () => {
    expect(read('node_modules/@devkit-inc/electron-ui/dist/zoom.js')).toContain("'zoom:neutral'")
    expect(read('node_modules/@devkit-inc/react-ui/dist/appbar.css')).toContain('--ds-zoom-neutral')
  })
})

