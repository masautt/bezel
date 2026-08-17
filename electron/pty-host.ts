// The utility process that owns every pty.
//
// This file exists for one reason: `nodePty.spawn` is a synchronous native call
// that costs ~5.1s on the first spawn of a run, and until now it ran on
// Electron's main process — the same thread that owns the window's message
// loop. Everything queued behind it: IPC, window updates, and the minimize /
// maximize / close buttons, which are IPC round trips and so appeared dead for
// the whole launch before all firing at once.
//
// Nothing here is clever. It receives messages, calls the SAME `pty-manager`
// that used to run in main, and posts its callbacks back. `pty-manager.ts` is
// unchanged and its unit tests are untouched — the manager did not move
// logically, only physically.
//
// See the design doc (private specs repo).
import { readFileSync } from 'fs'
import * as nodePty from 'node-pty'
import { createPtyManager } from './pty-manager.js'
import { createHostHandler } from './pty-host-handler.js'
import { normalizePaneTheme, DEFAULT_PANE_THEME } from './pane-theme.js'
import type { HostInbound, HostOutbound } from './pty-protocol.js'

function post(message: HostOutbound): void {
  process.parentPort.postMessage(message)
}

// The message loop itself lives in pty-host-handler.ts, which is the testable
// half: `process.parentPort` below does not exist under vitest, and the fault
// path it guards — a spawn that throws taking the whole host with it — is the
// only part of this file with any behaviour in it.
const handle = createHostHandler({
  post,
  createManager(shellPath, fallbackWarning, paneThemeFile) {
    // Read locally rather than asking main for the value. The manager's
    // PaneThemeSource is `{ file, read() }` precisely so it can be satisfied
    // wherever it is hosted; a round trip to main for eight bytes would put this
    // process back to waiting on the one it was moved off.
    const read = () => {
      try {
        return normalizePaneTheme(readFileSync(paneThemeFile, 'utf-8').trim())
      } catch {
        // Absent until the renderer has applied a theme once — the default is
        // correct, not a degraded mode. Same reasoning as main's reader.
        return DEFAULT_PANE_THEME
      }
    }

    return createPtyManager(nodePty.spawn as never, shellPath, fallbackWarning, {
      file: paneThemeFile,
      read,
    })
  },
})

process.parentPort.on('message', e => handle(e.data as HostInbound))

// Announce readiness only after the listener above is installed. Anything main
// posts before this point is dropped by Electron, so the bridge holds its
// messages — `init` included — until it sees this.
post({ t: 'ready' })
