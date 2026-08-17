import type { PaneRole, PaneKey } from '@shared/types.js'
import type { SessionIntent } from '../src/tabs.js'
// Relative, not the `@shared` alias: these are runtime value imports, and tsc
// does not rewrite path-mapped specifiers on emit (lint-enforced in electron/).
// UUID_RE is shared with parseTab() in the same module rather than duplicated:
// this is the last line of defense before a `--resume` target is spliced into a
// live PowerShell -Command string, and parseTab is the gate that keeps a
// hand-edited config.json from reaching it at all. Two copies could drift, and
// the failure that drift produces is a silently-fresh conversation.
import { parsePaneKey, UUID_RE } from '../src/tabs.js'
import { sanitizePaneEnv } from '../src/env.js'
import { createBannerRewriter } from '../src/banner.js'
import { psLiteral } from './pane-theme.js'
import { randomUUID } from 'node:crypto'

export interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
}

export type SpawnFn = (
  file: string,
  args: string[],
  opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }
) => PtyLike

/**
 * Where the panes' prompt theme lives, and what it currently says.
 *
 * `file` is re-read by the prompt on every render, which is what makes a theme
 * change reach a pane that is already open. `read` supplies the same value to
 * the spawn environment, so the FIRST prompt is correct too — including in the
 * claude pane, which gets no hook but does show a prompt once Claude exits.
 * Injected rather than read here so this module stays free of fs, like the rest
 * of the pure-ish electron/ services.
 */
export interface PaneThemeSource {
  file: string
  read(): string
}

// The two panes are fixed. `claude` inlines the body of the user's `csource`
// profile function (cd ~/source + claude --dangerously-skip-permissions) —
// see buildClaudeCommand for why it is inlined rather than called.
//
// The shell pane reports its working directory on every prompt via OSC 7, which
// the renderer taps to keep the widgets in sync as the user cd's around. The
// hook wraps whatever `prompt` the user's profile defines rather than replacing
// it, and is passed on the command line so the real profile stays untouched.
//
// The theme line is first inside the wrapper, and that ordering is the whole
// mechanism: `& $__cpOld` is what runs oh-my-posh, and oh-my-posh evaluates its
// `palettes.template` against the environment of the process that invokes it.
// Setting $env:BEZEL_THEME after that call would theme the NEXT prompt instead
// of this one — an off-by-one nobody would read as a bug, just as a prompt that
// lags a keystroke behind the theme.
//
// The `"" +` is load-bearing and was arrived at the hard way. Get-Content on a
// missing path with `-EA 0` yields NO output — not $null — and `[string]` of an
// empty pipeline is $null rather than '', so the obvious
// `([string](Get-Content …)).Trim()` throws "You cannot call a method on a
// null-valued expression" on EVERY prompt render until the file first exists.
// That is the state of a fresh install, so the first thing a new user would see
// is a PowerShell error stacked above every prompt. Concatenating onto '' forces
// a string in both cases; verified against pwsh 7 with the file present, absent,
// and written with Set-Content's default trailing newline (hence the .Trim()).
function buildShellHook(paneTheme?: PaneThemeSource): string {
  const seed = paneTheme ? `$__bzTheme = ${psLiteral(paneTheme.file)}; ` : ''
  const readTheme = paneTheme
    ? '$env:BEZEL_THEME = ("" + (Get-Content $__bzTheme -Raw -EA 0)).Trim(); '
    : ''
  return (
    seed +
    '$__cpOld = (Get-Command prompt).ScriptBlock; ' +
    'function prompt { ' + readTheme + '$p = & $__cpOld; ' +
    "Write-Host -NoNewline (\"`e]7;file:///\" + ($PWD.Path -replace '\\\\','/') + \"`a\"); $p }"
  )
}

/**
 * The claude pane's command, inlined from the user's `csource` profile function
 * so the pane can run under -NoProfile.
 *
 * Loading the pwsh profile costs ~1.6s of the ~2.5s it takes this shell to reach
 * a prompt, and it is time spent BEFORE claude itself starts booting — paid on
 * every new tab, on two panes at once. The claude pane is the one pane that does
 * not need the profile: it registers no prompt hook (that is the shell pane, see
 * buildShellHook) and its only profile dependency was `csource` itself, which is
 * four lines. Inlining them buys the whole profile load back.
 *
 * The profile is dot-sourced at the END, after claude exits, because a claude
 * pane that has been quit out of drops to a live prompt the user goes on using —
 * that prompt should be the themed, fully-configured one, same as before. By
 * then it is off the critical path.
 *
 * Deliberately 5.1-compatible syntax (no `??`): main.ts falls back to
 * powershell.exe when pwsh is not on PATH, and a parse error there would leave
 * the pane dead rather than merely degraded.
 *
 * $PROFILE is defined under -NoProfile (it is just a path), but the file need
 * not exist — dot-sourcing a missing path throws, hence the Test-Path guard.
 */
function buildClaudeCommand(sessionFlagStr: string): string {
  return (
    "$d = $env:CSOURCE_DIR; if (-not $d) { $d = Join-Path $HOME 'source' }; " +
    // Same guard as csource: Set-Location on a missing dir is non-terminating,
    // so without it claude launches --dangerously-skip-permissions in whatever
    // directory the pty happened to start in.
    'if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; ' +
    'Set-Location $d; ' +
    // claude-code auto-updates by deleting and re-extracting a ~300MB claude.exe
    // into the global npm prefix, which takes ~10s. The claude.ps1 shim on PATH
    // SURVIVES that window, so `Get-Command claude` still succeeds while its
    // target is missing and the pane dies with "The term ...claude.exe is not
    // recognized" thrown from inside the shim. Probing is therefore useless;
    // retrying the call is not. Costs nothing when claude is present.
    `$n = 0; while ($true) { try { claude --dangerously-skip-permissions${sessionFlagStr}; break } ` +
    'catch [System.Management.Automation.CommandNotFoundException] { ' +
    "if ($n -eq 0) { Write-Host -ForegroundColor Yellow 'claude is mid-update - waiting...' }; " +
    "if ($n -ge 60) { Write-Host -ForegroundColor Red 'claude not found after 30s - giving up.'; break }; " +
    'Start-Sleep -Milliseconds 500; $n++ } }; ' +
    'if (Test-Path $PROFILE) { . $PROFILE }'
  )
}

/**
 * `--session-id` for a new conversation, `--resume` for one we are returning
 * to. The shell pane gets nothing: only claude has sessions.
 */
function sessionFlag(role: PaneRole, intent: SessionIntent, id: string | null): string {
  if (role !== 'claude' || !id || !UUID_RE.test(id)) return ''
  return intent.mode === 'resume' ? ` --resume ${id}` : ` --session-id ${id}`
}

function argsFor(
  role: PaneRole,
  intent: SessionIntent,
  id: string | null,
  warningBanner: string,
  paneTheme?: PaneThemeSource,
): string[] {
  return role === 'claude'
    ? ['-NoLogo', '-NoExit', '-NoProfile', '-Command', warningBanner + buildClaudeCommand(sessionFlag(role, intent, id))]
    : ['-NoLogo', '-NoExit', '-Command', warningBanner + buildShellHook(paneTheme)]
}

export interface PtyManager {
  /**
   * `key` is `${tabId}:${role}` — see paneKey() in src/tabs.ts. Returns the
   * claude session uuid the pane is now running under — minted for `new`,
   * echoed back for `resume`, or inherited from an adopted spare — or null
   * for a shell pane or a malformed key.
   */
  spawn(key: PaneKey, cwd: string, intent: SessionIntent): string | null
  write(key: PaneKey, data: string): void
  resize(key: PaneKey, cols: number, rows: number): void
  kill(key: PaneKey): void
  /** Kill every live pty across every tab. Used by app before-quit. */
  killAll(): void
  /**
   * Start (or resume) filling the spare pool at `cwd`, up to WARM_DEPTH tabs'
   * worth, ready for the next new tabs to adopt. Spares at any other cwd, or
   * baked against a stale theme, are reaped as the fill proceeds. `delayMs`
   * defers the FIRST spawn — the caller generally does not want spares competing
   * for CPU and network with the panes the user is actually waiting on.
   */
  prewarm(cwd: string, delayMs?: number): void
  /** Kill the spares and cancel any pending prewarm. */
  discardWarm(): void
  onData(cb: (key: PaneKey, data: string) => void): void
  onExit(cb: (key: PaneKey, code: number) => void): void
}

/**
 * Output a spare produces before anything adopts it, replayed into the pane on
 * adoption. Capped so a spare that sits for hours printing (a runaway process, a
 * chatty MOTD) cannot grow without bound; the OLDEST chunks are dropped, since
 * the tail is what the terminal would be showing. In practice claude's opening
 * frame is a few KB and this never binds.
 */
const WARM_BUFFER_LIMIT = 256 * 1024

/** How long after an adoption to start spawning its replacement. See prewarm(). */
const REWARM_DELAY_MS = 2000

/**
 * How many tabs' worth of spares to keep ready — three, so a burst of new tabs
 * is instant rather than just the first one.
 *
 * The pool is not free: each tab-worth is a pwsh plus a fully booted claude
 * sitting idle, and at this depth that is six processes and a few hundred MB
 * that the user is not looking at. Three is the point where opening tabs
 * "feels infinite" in practice; deeper mostly buys idle RSS.
 */
const WARM_DEPTH = 3

/**
 * Gap between consecutive spare spawns, and the reason the pool fills ONE pty
 * at a time rather than in one pass.
 *
 * Two costs force the stagger. nodePty.spawn is synchronous on the main thread —
 * several seconds per window's worth — so spawning six back to back would freeze
 * the UI outright. And claude's boot is dominated by remote MCP connector
 * handshakes; three of those racing each other are slower than three in sequence,
 * and they contend with the pane the user is actually typing in.
 *
 * PANE_GAP is the short hop between the two panes of ONE tab-worth: a spare tab
 * is only useful complete, so its shell follows its claude closely. ROUND_GAP is
 * the long wait before starting the NEXT tab-worth — depth beyond the first is
 * insurance, and there is no hurry to buy it.
 */
const PANE_GAP_MS = 2000
const ROUND_GAP_MS = 60_000

/** Fill order within a round. claude first: it is the one with the slow boot. */
const ROLES: PaneRole[] = ['claude', 'shell']

/**
 * A pty plus the context needed to decide, later, whether it is still the right
 * pty to hand to a pane. `key` is null while it is an unadopted spare — which is
 * also what tells the data handler to buffer rather than fan out.
 */
interface Pane {
  pty: PtyLike
  role: PaneRole
  /** Where it was spawned. A spare is only adopted for a matching cwd. */
  cwd: string
  /** The BEZEL_THEME baked into its environment at spawn. */
  theme: string
  key: PaneKey | null
  /** The claude session uuid this pane was spawned with, or null for a shell pane. */
  sessionId: string | null
  buffer: string[]
  bufferBytes: number
  exited: boolean
}

// `fallbackWarning`, if given, is printed (yellow) as the first thing in
// every pane before its normal command runs — used when the caller had to
// fall back off pwsh.exe (PowerShell 7) to Windows PowerShell, which loads a
// different profile and so has none of the user's prompt/function setup.
// Without this the panes just come up subtly wrong with no explanation of why.
export function createPtyManager(
  spawnFn: SpawnFn,
  shellPath = 'pwsh.exe',
  fallbackWarning?: string,
  paneTheme?: PaneThemeSource,
  opts?: { newId?: () => string }
): PtyManager {
  const warningBanner = fallbackWarning
    ? `Write-Host -ForegroundColor Yellow ${JSON.stringify(fallbackWarning)}; `
    : ''
  const newId = opts?.newId ?? randomUUID
  const ptys = new Map<PaneKey, PtyLike>()
  const dataCbs: Array<(key: PaneKey, data: string) => void> = []
  const exitCbs: Array<(key: PaneKey, code: number) => void> = []
  /**
   * Idle spares per role, oldest first, awaiting adoption by the next new tabs.
   * Up to WARM_DEPTH each. Oldest first because an older spare is the one whose
   * claude has had the most time to finish its handshakes.
   */
  const warm: Record<PaneRole, Pane[]> = { claude: [], shell: [] }
  let warmTimer: ReturnType<typeof setTimeout> | null = null

  // Read per spawn, not once at construction: a pane restarted after a theme
  // change must come up on the new theme, and "restart" here covers the
  // keystroke-revive path and Open here as well as a new tab.
  const currentTheme = () => (paneTheme ? paneTheme.read() : '')

  /**
   * Spawn a pty and wire its handlers ONCE, for both the adopted and the spare
   * case. The handlers read `pane.key` on every event rather than closing over a
   * key, which is what lets a spare start life buffering with no key at all and
   * begin fanning out the instant one is assigned.
   */
  function createPane(role: PaneRole, cwd: string, key: PaneKey | null, intent: SessionIntent): Pane {
    const theme = currentTheme()
    // A claude pane always has an id: `new` mints one so the conversation can be
    // resumed later, `resume` reuses the one we were handed. A spare mints its
    // id here too, before any tab exists to own it.
    const sessionId = role === 'claude' ? (intent.mode === 'resume' ? intent.id : newId()) : null
    const pty = spawnFn(shellPath, argsFor(role, intent, sessionId, warningBanner, paneTheme), {
      cwd,
      cols: 80,
      rows: 24,
      env: paneTheme
        ? { ...sanitizePaneEnv(process.env), BEZEL_THEME: theme }
        : sanitizePaneEnv(process.env),
    })
    const pane: Pane = { pty, role, cwd, theme, key, sessionId, buffer: [], bufferBytes: 0, exited: false }
    // Claude's mascot becomes bezel's wordmark. Only the claude pane prints a
    // banner, and only that pane pays for the scan. Applied here, at the top of
    // onData, so the rewritten bytes are what gets BUFFERED as well as what
    // gets fanned out — a spare adopted later replays its banner from this
    // buffer, and would otherwise replay the mascot.
    const rewriteBanner = role === 'claude' ? createBannerRewriter() : null
    pty.onData(raw => {
      const d = rewriteBanner ? rewriteBanner(raw) : raw
      // The rewriter holds back a chunk that ends mid-escape or mid-art run
      // until the rest arrives, so it can legitimately return nothing at all.
      // Emitting that would buffer an empty string and wake the renderer for
      // no reason.
      if (d === '') return
      if (pane.key === null) {
        pane.buffer.push(d)
        pane.bufferBytes += d.length
        // Keep at least one chunk: dropping to empty would replay nothing at
        // all, which looks like a hung pane rather than a truncated one.
        while (pane.bufferBytes > WARM_BUFFER_LIMIT && pane.buffer.length > 1) {
          pane.bufferBytes -= pane.buffer.shift()!.length
        }
        return
      }
      const owner = pane.key
      dataCbs.forEach(cb => cb(owner, d))
    })
    pty.onExit(e => {
      pane.exited = true
      const owner = pane.key
      // spawn() kills the previous pty for this key, registers the new one
      // synchronously, and only then does the OLD pty's exit event arrive
      // (child processes exit asynchronously). Without this guard, that
      // stale exit would delete the fresh entry — every later write/resize
      // would silently no-op and the renderer would be told the just-spawned
      // pane exited. The same guard covers a killed tab whose exit lands
      // after the map entry is gone, and a spare that dies unadopted (owner
      // null), which no pane must ever hear about.
      if (owner !== null && ptys.get(owner) === pty) {
        ptys.delete(owner)
        exitCbs.forEach(cb => cb(owner, e.exitCode))
      }
    })
    return pane
  }

  /**
   * The spare for `role`, if it is still fit to hand to a pane — removed from
   * the pool either way, since an unfit spare is only worth killing.
   *
   * Three ways a spare goes stale, all of them worse than having none: it died
   * while idle (adopting it shows a dead pane), the user changed theme after it
   * was spawned (BEZEL_THEME is baked at spawn, so its prompt would be the old
   * color), or the pane wants a different directory than the spare sits in.
   * That last one is what keeps this correct for the restart and Open-here
   * paths, which spawn at an arbitrary cwd — only a genuine new tab, which
   * always opens at sourceRoot, matches a spare.
   */
  /**
   * Whether a spare is still worth handing to a pane. See takeWarm().
   *
   * The theme half applies to the SHELL pane only, and the asymmetry is the
   * point. BEZEL_THEME is baked into the environment at spawn and cannot be
   * changed in place, so on the face of it a theme change spoils every spare.
   * But the two roles wear it very differently:
   *
   *  - The shell pane draws a themed prompt the instant the tab opens, so a
   *    stale one is visible immediately. Its hook re-reads the theme FILE on
   *    every prompt (buildShellHook), which is how a shell that is ALREADY
   *    running follows a theme change — but the env var still colours its very
   *    first prompt, so a stale spare is worth rejecting.
   *
   *  - The claude pane runs under -NoProfile with no hook at all, and nothing
   *    in it consults BEZEL_THEME until claude EXITS and the profile's prompt
   *    takes over. Discarding one costs the tens of seconds of remote MCP
   *    connector handshakes its boot is dominated by — the single most
   *    expensive thing this pool holds — to correct a colour the user cannot
   *    see until they quit claude in that pane.
   *
   * Rejecting the whole pool on a theme change therefore bought a prompt colour
   * nobody was looking at and charged the next few new tabs a cold start for it.
   */
  const isFit = (spare: Pane, cwd: string) =>
    !spare.exited &&
    spare.cwd === cwd &&
    (spare.role === 'claude' || spare.theme === currentTheme())

  function takeWarm(role: PaneRole, cwd: string): Pane | null {
    const queue = warm[role]
    // Discard down the queue rather than giving up at the first unfit spare: with
    // a pool this deep, one stale entry must not mask the two good ones behind it.
    while (queue.length) {
      const spare = queue.shift()!
      if (isFit(spare, cwd)) return spare
      if (!spare.exited) spare.pty.kill()
    }
    return null
  }

  function killWarm() {
    for (const role of ROLES) {
      for (const spare of warm[role]) spare.pty.kill()
      warm[role] = []
    }
  }

  /**
   * Drop the spares that have gone stale since they were spawned, so the depth
   * count below reflects spares that could actually be adopted. Runs on every
   * fill tick, which is what turns a theme change or a dead spare into a REPLACED
   * spare instead of a hole the user discovers by opening a tab.
   */
  function reapStale(cwd: string) {
    for (const role of ROLES) {
      warm[role] = warm[role].filter(spare => {
        if (isFit(spare, cwd)) return true
        if (!spare.exited) spare.pty.kill()
        return false
      })
    }
  }

  /**
   * The role most in need of a spare, or null when the pool is full. Shallowest
   * queue wins, ties going to ROLES order — which fills breadth-first, one
   * complete tab-worth at a time, rather than three claudes and no shells.
   */
  function nextWarmRole(): PaneRole | null {
    let pick: PaneRole | null = null
    for (const role of ROLES) {
      if (warm[role].length >= WARM_DEPTH) continue
      if (!pick || warm[role].length < warm[pick].length) pick = role
    }
    return pick
  }

  /**
   * Spawn ONE spare after `delayMs`, then re-arm for the next one until the pool
   * is full. A single timer for the whole chain: the pool must never have two
   * fills in flight, or the stagger it exists to enforce is gone.
   */
  function schedulePrewarm(cwd: string, delayMs: number) {
    if (warmTimer) clearTimeout(warmTimer)
    warmTimer = setTimeout(() => {
      warmTimer = null
      reapStale(cwd)
      const role = nextWarmRole()
      if (!role) return
      // A spare's spawn is the one with no caller. `spawnFn` is a synchronous
      // native call that throws — and `cwd` here is up to PREWARM_DELAY_MS
      // stale, so a directory that existed when the fill was requested may not
      // exist when this fires. Unguarded, that exception unwinds out of the
      // timer callback and terminates the host, killing every pane that was
      // working perfectly — to fail at building a spare nobody has asked for.
      //
      // Stopping the chain rather than re-arming it: whatever broke is not
      // going to be fixed by trying again in two seconds, and the next real
      // prewarm (a new tab, a theme change) restarts the fill anyway.
      try {
        warm[role].push(createPane(role, cwd, null, { mode: 'new' }))
      } catch {
        return
      }
      const next = nextWarmRole()
      if (!next) return
      // Finishing the tab-worth just started is urgent in a way that starting the
      // next one is not — see PANE_GAP_MS.
      const gap = warm[next].length < warm[role].length ? PANE_GAP_MS : ROUND_GAP_MS
      schedulePrewarm(cwd, gap)
    }, delayMs)
    // Node keeps the process alive for a pending timer; a spare is a nicety and
    // must never be the reason the app lingers at quit.
    warmTimer.unref?.()
  }

  return {
    spawn(key, cwd, intent) {
      // A malformed key has no role to pick args from. Ignore it rather than
      // guessing a shell — a wrong guess would silently spawn the wrong pane.
      const parsed = parsePaneKey(key)
      if (!parsed) return null
      ptys.get(key)?.kill()
      // A resume must never take a spare: a spare is a generic pre-booted
      // claude and cannot retroactively become your conversation. This is the
      // cost of resuming at all, and why restore is lazy.
      if (parsed.role === 'claude' && intent.mode === 'resume') {
        const pane = createPane('claude', cwd, key, intent)
        ptys.set(key, pane.pty)
        return pane.sessionId
      }
      const spare = takeWarm(parsed.role, cwd)
      if (spare) {
        // Adopt: claim it for this key, register it, then replay everything it
        // said while nobody was listening. Order matters — the replay fans out
        // through `pane.key`, so it has to be set first.
        spare.key = key
        ptys.set(key, spare.pty)
        const pending = spare.buffer
        spare.buffer = []
        spare.bufferBytes = 0
        // Buffered against the spare's 80x24; the renderer resizes immediately
        // after this call and the TUI repaints itself at the real size.
        for (const chunk of pending) dataCbs.forEach(cb => cb(key, chunk))
        // Replace what was just consumed, but not instantly: the tab that just
        // opened is the one the user is looking at, and a fresh claude booting
        // beside it competes for exactly the network and CPU it needs.
        schedulePrewarm(spare.cwd, REWARM_DELAY_MS)
        return spare.sessionId
      }
      const pane = createPane(parsed.role, cwd, key, intent)
      ptys.set(key, pane.pty)
      return pane.sessionId
    },
    write(key, data) { ptys.get(key)?.write(data) },
    resize(key, cols, rows) { ptys.get(key)?.resize(cols, rows) },
    kill(key) { ptys.get(key)?.kill(); ptys.delete(key) },
    killAll() {
      for (const pty of ptys.values()) pty.kill()
      ptys.clear()
      if (warmTimer) { clearTimeout(warmTimer); warmTimer = null }
      killWarm()
    },
    prewarm(cwd, delayMs = 0) { schedulePrewarm(cwd, delayMs) },
    discardWarm() {
      if (warmTimer) { clearTimeout(warmTimer); warmTimer = null }
      killWarm()
    },
    onData(cb) { dataCbs.push(cb) },
    onExit(cb) { exitCbs.push(cb) },
  }
}
