# bezel

An Electron app hosting two headless terminals (Claude and shell) side by side
in a centered column, with project context widgets in the side gutters. The
gutters split by subject: the left is **where am I**, the right is **what is
this session doing**.

Left:

- **Context** — the resolved org/repo for the shell pane's current directory,
  its branch, and the live cwd. Its `switch` button opens a repo switcher over
  every scanned repo on the machine: click a row to re-point the gutters at it
  (the terminals keep running), or `⏎` to move both terminals there, which
  replaces the running processes and so asks for a second click to confirm.
- **Changes** — `git status` for the current repo (branch, ahead count, dirty
  files). It says `reading…` and `unavailable` where it means them, and `clean`
  only when it has actually read a clean tree.

Right:

- **Session** — the running list of claude's own task summaries for this tab,
  captured from the OSC 0 titles the tab strip can only show one of.
- **Specs** — design docs / plans for the current project, read from a Supabase
  table. Clicking one opens the generated `.html` from the local specs repo in
  your browser, which renders it. If that repo is not cloned here, it falls back
  to the `.md` on GitHub — deliberately not the `.html`, which GitHub's blob view
  shows as source rather than rendering. This widget needs credentials that are
  specific to my own setup; without them it shows "unavailable" and nothing else
  in the app is affected.
- **Window** — how full the claude pane's context window is. Read from the
  session transcript under `~/.claude/projects`, not from the pane (a pty is a
  terminal, not an API), so the numbers are the ones the API itself returned.
  It advances one step per assistant turn and marks itself `idle` rather than
  letting a bar frozen mid-run pass for a live one.
- **Usage** — both plan limits, the rolling five-hour window and the seven-day
  one, from the same endpoint Claude Code's own `/usage` reads. The OAuth token
  stays in the main process; only percentages reach the renderer.

Neither gauge ever shows a zeroed bar for a reading it does not have: they say
`reading…`, `no session here` or `unavailable` instead.

The shell pane's cwd drives everything: `cd`-ing there (via an OSC 7 escape)
updates Context, Specs, and Changes within one prompt. Bezel also remembers
the last cwd across launches (`project:remember` / `project:last`), so
relaunching restores where you left off instead of starting at a hardcoded
root.

**When the cwd resolves to nothing** — which is the case at `~/source`, bezel's
own default launch directory, since it sits outside `orgs/` — the widgets fall
back to the last repo that *did* resolve, marked `pinned`, rather than going
dark. The live cwd is still shown on its own row, so the two facts never get
confused. Landing anywhere real under `orgs/` replaces the pin immediately.

## Tabs

A tab is a whole workspace — its own claude pty, shell pty and cwd. Every tab's
panes stay mounted and alive; switching hides the inactive ones rather than
tearing anything down, so a background claude session is genuinely untouched.

When a pane rings the terminal bell — claude finishing a turn, a build ending, a
command asking for input — and you are **not** watching it, the tab gets a
pulsing dot and a soft two-note chime. Nothing fires for a pane you are already
looking at in a focused window. The mark clears when you activate that tab,
whichever way you get there, and returning focus to the window clears only the
tab already in front of you. The chime is on by default and switched off in
Settings → Appearance.

## Launch

Two different waits, with two different causes:

- **Opening a new tab** costs ~50s of Claude connector init. That is fixed
  rather than additive, so it can only be hidden: bezel keeps one prewarmed
  spare pty per role, buffers whatever it prints before adoption, and replays
  that into the pane when a new tab claims it.
- **Opening the window** costs ~8s, and it is `node-pty`'s synchronous spawn
  blocking the main process. Until that is fixed structurally, a loading screen
  covers the interval — the renderer is a separate process and keeps painting
  throughout. Its messages come from a Supabase table with a built-in array and
  a `localStorage` cache beneath it, because any IPC sent during the block would
  queue behind the block.

## Layout

Every dimension is draggable and persists:

- The two **gutters** resize from their inner edges (clamped 160–520px).
- The **claude/shell split** resizes, as it always has.
- Each **widget** resizes from the grabber below it, and collapses by clicking
  its header.

Double-click any grabber to reset that one dimension. Widths are pixels; widget
heights are fractions of their gutter, so they survive a window resize.

## Settings

`Ctrl+,` opens Settings.

- **Layout** — named presets you can save, rename, delete and switch between,
  plus per-widget visibility and ordering within a gutter. The live layout is
  deliberately *not* the active preset: dragging changes what you see, and a
  preset only changes when you Save. Drift shows as "modified".
- **Appearance** — theme, mirroring the toggle already in the title bar's ⋯ menu
  (both drive the same setting), and the ready chime described under Tabs.
- **About** — version and the three derived roots, which is the first place to
  look if paths resolve oddly.

Presets sync to Supabase so they follow you between machines; the live layout
stays local in `config.json`, because it
changes on every pointermove, is needed at first paint, must work offline, and
is specific to the display it was dragged on. Sync is best-effort in both
directions — offline or without credentials, everything still works from the
local copy.

## Run it

```bash
npm install
npm run electron:dev
```

`npm run dev` runs the Vite dev server alone (renderer only, no window).
`npm run electron:hmr` runs Vite + Electron together with live reload.
`npm run electron:dist` packages an NSIS installer into `release/` (see
"Packaging" below).

No credentials are needed to run bezel. The two Supabase-backed features (the
Specs widget and layout-preset sync) look for a credentials file that is part of
my own machine setup; when it isn't there — which is the case for any fresh
clone — they report "unavailable" and everything else works normally. Credentials
are read in the main process only and are never handed to the renderer.

## Vendored dependencies

Bezel is built on two of my own shared packages — `@devkit-inc/electron-ui` and
`@devkit-inc/react-ui` (plus `theme-tokens` beneath them) — which are published
to a private registry. Rather than leave this repo uninstallable, their built
output is vendored under `vendor/@devkit-inc/` and wired up as `file:`
dependencies, so `npm install` works from a plain clone with no auth.

They are a snapshot, not a subtree: upstream fixes land here only when the
snapshot is refreshed.

## Prerequisites

Two things `npm install` alone does not fully provision:

1. **The Electron binary.** `npm install` downloads the `electron` package's
   JS wrapper, but the actual binary is fetched separately from the release
   CDN as a postinstall step. If that download failed or was skipped (e.g.
   offline, blocked CDN), `node_modules/electron/dist/` will be missing
   everything but `locales/`, and `require('electron')` throws "Electron
   failed to install correctly". Re-run the download with:

   ```bash
   node node_modules/electron/install.js
   ```

That is the only one. **No C++ toolchain is required, and you should not run
`npm run rebuild`** — earlier versions of this file said otherwise, and following
it costs a multi-gigabyte Visual Studio install for a compile that cannot change
the result.

`node-pty` 1.1.0 is **N-API** (`node-addon-api ^7.1.0`), not NAN. N-API is
ABI-stable across Node and Electron, so there is nothing to re-link against
Electron's ABI: the binary that ships is the binary that runs. node-pty carries a
complete `prebuilds/win32-x64/` (`pty.node`, `conpty*`, `winpty*`), and its
`lib/utils.js` resolves `build/Release` → `build/Debug` →
`prebuilds/<platform>-<arch>`, so the empty `build/Release` falls through to the
prebuild. This also means an Electron version bump needs no rebuild.

`npm run rebuild` remains in `package.json` as an escape hatch for the one case
that still needs a compiler — `npm_config_build_from_source`, which deletes the
prebuilds on purpose. Reach for it then and not otherwise.

## Packaging

```bash
npm run electron:dist
```

Produces `release/bezel Setup 1.0.0.exe` via `electron-builder.config.cjs`.
`node-pty` is a native module and cannot be loaded from inside an asar
archive, so the config unpacks it explicitly
(`asarUnpack: ['**/node_modules/node-pty/**']`) — do not remove that line.

The config also sets **`npmRebuild: false`**, which is load-bearing on any box
without Visual Studio. Left at its default of `true`, electron-builder runs
`@electron/rebuild` → `node-gyp` unconditionally and the packaging step dies with
`Could not find any Visual Studio installation` — attempting a compile whose only
possible output is a byte-identical replacement for the working prebuild described
under Prerequisites. If a build ever fails on Visual Studio, check that flag before
installing a toolchain.

## Conventions

- In `electron/`, never use a bare `@shared/*` import for a runtime value — `tsc` does not rewrite path-mapped specifiers on emit, so it resolves to a nonexistent `@shared` package in Node. Use a relative `../src/*.js` import instead (`import type` through `@shared/*` is fine; it gets erased). Enforced by an eslint override in `.eslintrc.cjs`.

## Design and plan

The design docs and implementation plans live in a private specs repo and are
not published here.

### node-pty and Spectre-mitigated libraries

Only relevant if you deliberately compile — see Prerequisites; the normal install and
packaging paths never invoke node-gyp.

`node-pty` opts into Spectre-mitigated MSVC libraries, which a standard Build Tools
install does not ship — `npm run rebuild` would fail with **MSB8040**. `patches/node-pty+1.1.0.patch`
turns that requirement off, and the `postinstall` script reapplies it automatically after
every `npm install` via patch-package. Keep the patch: it costs nothing when nothing
compiles, and it is what makes the escape hatch work on a box with plain Build Tools. If
you would rather build against the real mitigated libraries, install the
`Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre` component and delete the patch.
