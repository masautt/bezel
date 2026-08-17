import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { PaneKey } from '@shared/types'
import type { SessionIntent } from '@shared/tabs'
import { formatSpawnError } from '@shared/spawn-error'
import { clipboardAction } from '@shared/keys'
import { classifyLinkTarget, findFilePaths, isLinkActivation } from '@shared/links'
import { usableDimensions } from '@shared/pane-size'
import { terminalTheme, elementCssVars, THEME_ATTRIBUTES } from './terminalTheme'
import { attachGpuRenderer } from './renderer'

/**
 * How soon after a `--resume` spawn a silent exit counts as a FAILED resume
 * (the transcript no longer exists) rather than a real, if unusually fast,
 * session end. Both halves of the rule are required — see the check at the
 * exit handler below.
 */
const RESUME_FAILED_MS = 5000

export interface TerminalPaneProps {
  id: PaneKey
  cwd: string
  /**
   * What to spawn this pane's pty as: a fresh conversation, or a `--resume`
   * of a specific uuid. Passed straight through to `window.bezel.pty.spawn` —
   * see `SessionIntent`'s own doc for main's side of the contract.
   */
  intent: SessionIntent
  /**
   * Called with the uuid main assigned (or confirmed) this pane's claude pty,
   * once the spawn ack answers. Only meaningful for the claude pane — the
   * shell pane's pty has no session id to report, and main resolves `null`
   * for it, which this never fires for.
   */
  onSessionId?: (id: string) => void
  onOsc?: (payload: string) => void
  /**
   * Called with the process-reported terminal title (OSC 0/2). Claude Code
   * sets this to a summary of what it is working on; the tab strip uses it as
   * the tab's label. Only the claude pane passes this.
   */
  onTitle?: (title: string) => void
  /**
   * Called when the process rings the terminal bell (BEL, \x07). Claude Code
   * rings it when a turn ends or it needs an answer, and so does anything else
   * that wants you back — which is why this is wired on BOTH panes rather than
   * just claude's. What that means for the tab is App's call, not this pane's.
   */
  onBell?: () => void
  /**
   * Fired once the pane's initial spawn round-trip has completed. Used by the
   * launch screen, which must come down when the ptys are actually alive rather
   * than after a guessed delay.
   */
  onSpawned?: () => void
  /**
   * Fired once, on the FIRST byte this pane's pty ever emits — a prompt drawn, a
   * banner painted, anything. `onSpawned` says main handed back a process
   * handle; this says the process has actually produced something. The launch
   * screen wants both, because the gap between them is real: a shell still
   * running its profile has spawned and has nothing on screen.
   */
  onFirstData?: () => void
}

export function TerminalPane({ id, cwd, intent, onSessionId, onOsc, onTitle, onBell, onSpawned, onFirstData }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null)
  // The spawn effect below is deliberately mount-once (re-running it would
  // spawn a second pty for the same pane), so it closes over the `cwd` prop
  // from the mount. A restart happening later must land in the CURRENT
  // directory, not the launch directory, so a ref kept fresh on every render
  // stands in for the stale closure at the one place (restart) that needs it.
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  // Same reason as cwdRef: the spawn effect is mount-once, so it would pin the
  // first render's callback. A ref keeps the subscription pointed at the
  // current one without re-running (and re-spawning) the effect.
  const onTitleRef = useRef(onTitle)
  onTitleRef.current = onTitle
  // Same reason as onTitleRef: it is correct today only because App's `onOsc`
  // is `useCallback(…, [])` and a pane's tab id is constant for its layer —
  // a coincidence across two files, not a local invariant this effect can
  // rely on.
  const onOscRef = useRef(onOsc)
  onOscRef.current = onOsc
  // Same reason again: the bell subscription is made once, inside the
  // mount-once effect, so it must not close over the first render's callback.
  const onBellRef = useRef(onBell)
  onBellRef.current = onBell
  // Same mount-once reasoning as onTitleRef above.
  const onSpawnedRef = useRef(onSpawned)
  onSpawnedRef.current = onSpawned
  const onFirstDataRef = useRef(onFirstData)
  onFirstDataRef.current = onFirstData
  // Same mount-once reasoning as onSpawnedRef above.
  const onSessionIdRef = useRef(onSessionId)
  onSessionIdRef.current = onSessionId

  useEffect(() => {
    // Read off this element rather than hardcoding a second copy of the
    // palette, so the panes stay in lockstep if the tokens are re-themed.
    // terminalTheme() owns which token feeds which xterm slot, and why.
    const readTheme = () => terminalTheme(elementCssVars(host.current!))
    const term = new Terminal({
      scrollback: 10000,
      // Nerd Font or the pane renders Claude Code's and the shell prompt's
      // glyphs as tofu. Two complications, both of which cost a silent
      // fallback to Consolas if you list too few names:
      //
      //  1. Different machines have different nerd fonts. Linux/Ghostty here
      //     uses JetBrainsMono; the Windows box has CaskaydiaCove (what
      //     windows-terminal/settings.json and vscode/settings.json pick).
      //     Listing both lets CSS fall through to whichever is installed.
      //  2. Each font is registered under several names. nerd-fonts' own
      //     installer uses the long "… Nerd Font" name, while the winget
      //     packages register the short GDI family ("JetBrainsMono NF",
      //     "CaskaydiaCove NFM") — and only the short one matches here.
      //
      // The Mono/NFM cuts come first on purpose: their icons are squeezed to
      // one cell, so they stay on xterm's grid instead of overlapping the
      // next column the way the double-width NF cuts do.
      fontFamily:
        '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrainsMono Nerd Font", "JetBrainsMono NF", "JetBrainsMonoNL NF", ' +
        '"CaskaydiaCove Nerd Font Mono", "CaskaydiaCove NFM", "CaskaydiaCove Nerd Font", "CaskaydiaCove NF", ' +
        'Consolas, monospace',
      fontSize: 11,
      cursorBlink: true,
      allowProposedApi: true,
      theme: readTheme(),
    })

    // Picking a theme re-resolves the tokens this palette is built from. xterm
    // caches its palette, so without this the terminals would keep the old one
    // until a reload. THEME_ATTRIBUTES documents why the list is what it is —
    // an earlier version watched `data-theme` alone and missed every dark→dark
    // switch, which is most of them now the picker lists a library.
    const themeWatcher = new MutationObserver(() => { term.options.theme = readTheme() })
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [...THEME_ATTRIBUTES],
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()

    // Off the DOM renderer and onto the GPU. AFTER open(): the addon builds its
    // GL context during activation, which needs a terminal already attached to
    // an element — loading it any earlier throws, and the pane would fall back
    // to the very renderer this exists to leave. See renderer.ts for what
    // happens on a machine that has no WebGL2, or a driver that drops the
    // context mid-session; both end up back on the DOM renderer rather than on
    // a dead pane.
    const releaseRenderer = attachGpuRenderer(term, () => new WebglAddon())

    // Clipboard. xterm has no copy of its own: its selection lives in the
    // terminal's model rather than the DOM, so nothing outside can see it, and
    // ctrl+c is sent to the process as \x03. Bezel had no application menu
    // either (electron-ui calls Menu.setApplicationMenu(null)), so there was no
    // accelerator anywhere and copying was simply impossible.
    //
    // Returning false tells xterm to stop: the key is ours and must not reach
    // the pty. Every other combination returns true and behaves as before —
    // including ctrl+c with nothing selected, which still interrupts.
    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true
      const action = clipboardAction({
        key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey,
        hasSelection: term.hasSelection(),
      })
      if (action === 'copy') {
        const text = term.getSelection()
        if (text) void window.bezel.clipboard.write(text)
        return false
      }
      if (action === 'paste') {
        // Straight to the pty, not term.paste(): the pane is a view of a real
        // shell, and the shell is what should receive typed input.
        void window.bezel.clipboard.read().then(text => {
          if (text) void window.bezel.pty.write(id, text)
        })
        return false
      }
      return true
    })

    // Links. Three sources, one gate, one destination.
    //
    // A pane had none of this: the only addons loaded were fit and webgl, so a
    // URL in the scrollback was inert glyphs, and an OSC 8 hyperlink — which
    // claude emits — fell through to xterm's default of window.open, which in a
    // renderer with no setWindowOpenHandler pops a bare BrowserWindow rather
    // than reaching the OS browser at all.
    //
    // isLinkActivation gates all three, so ctrl+click means the same thing
    // wherever the link came from. The hover underline is deliberately NOT
    // gated: xterm decorates on hover alone, and suppressing that would mean
    // tracking modifier state across keydown/keyup to re-decorate. Activation is
    // what the gate has to protect.
    const openLink = (event: MouseEvent, text: string) => {
      if (!isLinkActivation({
        ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, button: event.button,
      })) return
      const target = classifyLinkTarget(text, cwdRef.current)
      if (!target) return
      if (target.kind === 'url') void window.bezel.openExternal(target.url)
      else void window.bezel.openFile({ path: target.path, line: target.line, col: target.col })
    }

    term.loadAddon(new WebLinksAddon((event, uri) => openLink(event as MouseEvent, uri)))

    // OSC 8. allowNonHttpProtocols because `file://` is the whole reason this
    // needs handling — classifyLinkTarget re-checks the scheme, so opening it up
    // here does not widen what can actually be launched.
    term.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate: (event, text) => openLink(event, text),
    }

    // File paths, which no addon covers. Reads cwdRef rather than the captured
    // `cwd` so relative paths resolve against wherever the pane is NOW — the
    // spawn effect is mount-once and would otherwise pin the launch directory.
    //
    // One row at a time, unlike the web-links addon, which stitches wrapped rows
    // back together before matching. A path long enough to wrap in a half-width
    // pane therefore does not linkify — deliberate for now, and the reason this
    // reads the row rather than the logical line.
    term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) return callback(undefined)
        const text = line.translateToString(true)
        const found = findFilePaths(text, cwdRef.current)
        if (!found.length) return callback(undefined)
        callback(found.map(match => ({
          // xterm columns are 1-based and its range end is inclusive, so an
          // exclusive 0-based `end` is already the number it wants.
          range: {
            start: { x: match.start + 1, y: bufferLineNumber },
            end: { x: match.end, y: bufferLineNumber },
          },
          text: text.slice(match.start, match.end),
          activate: (event: MouseEvent, linkText: string) => openLink(event, linkText),
        })))
      },
    })

    if (onOsc) term.parser.registerOscHandler(7, payload => { onOscRef.current?.(payload); return true })
    // xterm's built-in OSC 0/2 handling — a cleaner hook than the raw
    // registerOscHandler used for OSC 7 above. Disposed with the terminal.
    term.onTitleChange(title => onTitleRef.current?.(title))
    // xterm parses BEL out of the stream for us, so nothing here has to scan
    // bytes — and unlike a raw \x07 search it cannot false-positive on a BEL
    // that arrives inside an escape sequence's payload. Disposed with the
    // terminal, like onTitleChange.
    term.onBell(() => onBellRef.current?.())

    // While the pty is dead, keystrokes restart it instead of being forwarded.
    let dead = false
    let restarting = false
    // Mutable because a revive after a failed resume changes what "this
    // pane's intent" means for the rest of its life: `spawnedAt`/`sawData`
    // reset (a new pty gets its own timing window), and `activeIntent` flips
    // to `new` so a later silent exit — of a pty that was never a resume —
    // cannot be mistaken for the ORIGINAL resume failing again. Read by the
    // exit handler below; written only by the revive path.
    let activeIntent: SessionIntent = intent
    let spawnedAt = Date.now()
    let sawData = false
    // Both spawn paths below fail the same way and offer the same recovery, so
    // they render it the same way: red cause, then the identical "press any key"
    // affordance a normal process exit already trains the user to expect.
    const reportSpawnFailure = (what: string, err: unknown) => {
      term.write(`\r\n\x1b[31m[${what}: ${formatSpawnError(err)}]\x1b[0m\r\n`)
      term.write('\x1b[33m[press any key to retry]\x1b[0m\r\n')
    }
    term.onData(d => {
      if (dead) {
        // A restart is already in flight: swallow this and any further
        // keystrokes rather than forwarding them — there is no pty to write
        // to yet, and pty.write() would silently no-op until spawn resolves.
        if (restarting) return
        restarting = true
        // The keystroke that triggered this restart is deliberately not
        // forwarded to the new session — it only wakes the pane back up.
        term.write('\r\n')
        void (async () => {
          try {
            // Never the dead id, even when THIS restart is the recovery from a
            // failed resume — reusing it would silently retry the same
            // `--resume` against the same missing transcript forever.
            const sid = await window.bezel.pty.spawn(id, cwdRef.current, { mode: 'new' })
            if (sid) onSessionIdRef.current?.(sid)
            // A fresh pty, a fresh clock, and — critically — no longer a
            // `--resume`: see the note on `activeIntent` above. The pty is
            // registered in the manager's map the moment spawn resolves, so
            // the pane is alive HERE. These used to sit on the far side of the
            // resize, which meant a rejected resize left `dead` true and
            // `activeIntent` still `resume` over a pty that HAD started: the
            // pane reported "restart failed" and swallowed every keystroke for
            // the rest of its life, in front of a working terminal.
            activeIntent = { mode: 'new' }
            spawnedAt = Date.now()
            sawData = false
            dead = false
            // Cosmetic next to the spawn — the pty starts at 80x24 and the
            // next real resize (a window change, or the observer below)
            // corrects it — so its own failure must not be able to report the
            // restart as failed, and must not reach the catch below.
            await window.bezel.pty.resize(id, term.cols, term.rows).catch(() => {})
          } catch (err) {
            // Without this catch the IIFE rejects unhandled AND `restarting`
            // stays latched, so the guard above swallows every later keystroke:
            // one failed restart bricked the pane for the rest of its life.
            // `dead` deliberately stays true — there is still no pty.
            reportSpawnFailure('restart failed', err)
          } finally {
            restarting = false
          }
        })()
        return
      }
      void window.bezel.pty.write(id, d)
    })
    // Latched in the effect's own closure rather than in state: this fires on
    // every chunk for the life of the pane, and the launch screen needs exactly
    // the first one. A ref-free local boolean is the cheapest possible guard on
    // the hottest callback in the app.
    let announced = false
    const offData = window.bezel.pty.onData((paneId, data) => {
      if (paneId !== id) return
      term.write(data)
      sawData = true
      if (!announced) { announced = true; onFirstDataRef.current?.() }
    })
    const offExit = window.bezel.pty.onExit((paneId) => {
      if (paneId !== id) return
      dead = true
      // A `--resume` against a transcript that no longer exists exits on its
      // own. A pty is not an API, so this is inferred from timing — deliberately
      // narrowly: silence AND a fast exit. A resumed session that printed
      // anything took the normal exit path below.
      if (activeIntent.mode === 'resume' && !sawData && Date.now() - spawnedAt < RESUME_FAILED_MS) {
        term.write('\r\n\x1b[31m[could not reopen this session]\x1b[0m\r\n')
        term.write('\x1b[2mpress any key to start a fresh claude here\x1b[0m\r\n')
        return
      }
      term.write('\r\n\x1b[33m[process exited — press any key to restart]\x1b[0m\r\n')
    })

    // A new tab adopts a warm spare and paints immediately. A restored tab is a
    // cold `--resume` and would otherwise sit blank for ~50s, which reads as
    // broken — so say what is happening, through the same status path that
    // renders [failed to start: …].
    if (intent.mode === 'resume') {
      term.write('\r\n\x1b[2m[resuming session…]\x1b[0m\r\n')
    }

    // This promise resolves only when main's handler RETURNS, and main is
    // blocked inside a synchronous nodePty.spawn until the pty exists — which
    // makes it an exact readiness signal for the launch screen, with no extra
    // IPC channel. Reported on failure too: a pane that will never come up must
    // still not hold the launch screen open forever.
    void window.bezel.pty.spawn(id, cwd, intent).then(
      (sessionId) => {
        if (sessionId) onSessionIdRef.current?.(sessionId)
        onSpawnedRef.current?.()
      },
      (err: unknown) => {
        // Releasing the launch screen on failure is deliberate (see above), but
        // doing ONLY that made a dead pane indistinguishable from a live one:
        // you got a blank rectangle and no cause. Show why, and hand the pane to
        // the same keystroke-restart path a normal exit uses.
        dead = true
        reportSpawnFailure('failed to start', err)
        onSpawnedRef.current?.()
      }
    )
    void window.bezel.pty.resize(id, term.cols, term.rows)

    // Tell the pty the new size BEFORE fitting locally: the claude pane runs a
    // full-screen TUI that redraws against whatever dimensions it was last told.
    let timer: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // A pane with no box on screen measures as zero — or as NaN, when the
        // cell size it divides by is itself zero — and `!dims` alone does not
        // catch either. Forwarding one resizes a LIVE shell to a size no
        // terminal can be, and fitting to it would reshape this terminal's own
        // geometry on the way. Skipping both leaves the pane at the last size
        // it genuinely had, which is what it will still be when it reappears.
        const dims = usableDimensions(fit.proposeDimensions())
        if (!dims) return
        void window.bezel.pty.resize(id, dims.cols, dims.rows)
        fit.fit()
      }, 100)
    })
    ro.observe(host.current!)

    // releaseRenderer before term.dispose(): disposing the terminal would take
    // the addon with it, but only after tearing down the surface underneath it.
    // Releasing the GL context first is the order that leaves nothing to guess
    // about, and it is the one that matters — a context leaked per pane is paid
    // in GPU memory for the rest of the session.
    return () => { ro.disconnect(); themeWatcher.disconnect(); clearTimeout(timer); offData(); offExit(); releaseRenderer(); term.dispose() }
    // Mount-once: re-running this would spawn a second pty for the same pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // There was a second effect here that re-pointed a live pane at another
  // directory on demand, driven by the Context widget's "Open here". That
  // control and the repo switcher behind it are gone: `cd` in the shell pane is
  // the only way a tab moves now, and it needs no respawn — the pty is already
  // there, and OSC 7 carries the new directory to every widget on the next
  // prompt. The `refit` ref that existed only to re-size a respawned pty went
  // with it.
  return <div className="pane" ref={host} />
}
