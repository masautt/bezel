import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanApps } from '../electron/apps-service'

// A fake orgs/ tree covering every depth the real machine has. `.git` is created
// as a plain directory — isRepoDir only checks for its existence.
const ROOT = mkdtempSync(join(tmpdir(), 'bezel-apps-scan-'))
const repo = (rel: string) => {
  mkdirSync(join(ROOT, rel, '.git'), { recursive: true })
  return rel.replace(/\\/g, '/')
}
const plain = (rel: string) => mkdirSync(join(ROOT, rel), { recursive: true })

// depth 1 — a flat *-inc org repo (layout.json's nesting_rule, case one)
repo('devkit-inc/bezel')
// depth 2 — an also_clone owner nested under its housing org (case two)
repo('masautt-inc/masautt/somesite')
// depth 3 — component and template repos grouped under an app. NOT covered by
// nesting_rule, and the reason the old two-level scan missed 30 repos.
repo('sbrain-inc/finapp/comps/finapp-admin-comp')
repo('sbrain-inc/sbrain/templates/a-template')
// depth 5 — the deepest the layout contract permits: an also_clone owner carrying
// a three-segment explicit path. Not cloned on this machine (it is the county's),
// which is exactly why the bound follows layout.json's max_repo_depth rather than
// whatever happens to be checked out here.
repo('sbcbsd-inc/ITDBSD/teamx/customers/cao/cao-communicationsmetrics-adf')
// six levels below the org — one past the bound, and deliberately not found.
repo('sbrain-inc/deep/deeper/deepest/way/past/too-far')
// A repo INSIDE a repo: descent stops at the parent, so this is not a sibling.
mkdirSync(join(ROOT, 'devkit-inc/bezel/vendored/.git'), { recursive: true })
// Noise the walk must skip.
plain('devkit-inc/not-a-repo/still-not')

writeFileSync(
  join(ROOT, 'sbrain-inc/finapp/comps/finapp-admin-comp/manifest.json'),
  JSON.stringify({ group: 'finapp', description: 'admin comp' })
)

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const found = () => scanApps(ROOT)
const repos = async () => (await found()).map(e => e.repo).sort()

describe('scanApps', () => {
  // Measured on the real machine: 230 repos in 127ms, fully synchronous — six
  // times the "~20ms" the MAX_DEPTH comment claims, and all of it on the thread
  // that also carries every pty keystroke. The walk itself is unchanged; what
  // changed is that it no longer holds the main thread while it runs.
  it('scans without blocking its caller', () => {
    expect(scanApps(ROOT)).toBeInstanceOf(Promise)
  })

  it('finds repos at every depth the layout contract permits', async () => {
    expect(await repos()).toEqual([
      'ITDBSD/teamx/customers/cao/cao-communicationsmetrics-adf',
      'bezel',
      'finapp/comps/finapp-admin-comp',
      'masautt/somesite',
      'sbrain/templates/a-template',
    ])
  })

  // The regression this change fixes: two levels silently omitted 13% of the
  // repos on the real machine, with no way to reach any of them from Apps.
  it('finds the depth-3 comps repos a two-level walk missed', async () => {
    expect(await repos()).toContain('finapp/comps/finapp-admin-comp')
    expect(await repos()).toContain('sbrain/templates/a-template')
  })

  it('stops at MAX_DEPTH rather than walking the whole tree', async () => {
    expect(await repos()).not.toContain('deep/deeper/deepest/way/past/too-far')
  })

  // A repo's subdirectories are its contents, not more apps.
  it('does not descend into a repo it has already found', async () => {
    expect(await repos()).not.toContain('bezel/vendored')
  })

  it('labels the org and keeps the path below it as the repo name', async () => {
    const comp = (await found()).find(e => e.repo === 'finapp/comps/finapp-admin-comp')
    expect(comp?.org).toBe('sbrain-inc')
    expect(comp?.root).toBe(`${ROOT.replace(/\\/g, '/')}/sbrain-inc/finapp/comps/finapp-admin-comp`)
  })

  it('reads a manifest when present and falls back to the org otherwise', async () => {
    const comp = (await found()).find(e => e.repo === 'finapp/comps/finapp-admin-comp')
    expect(comp?.hasManifest).toBe(true)
    expect(comp?.group).toBe('finapp')
    const bezel = (await found()).find(e => e.repo === 'bezel')
    expect(bezel?.hasManifest).toBe(false)
    expect(bezel?.group).toBe('devkit-inc')
  })
})
