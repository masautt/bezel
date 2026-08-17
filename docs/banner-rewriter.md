# The bezel wordmark — how Claude's mascot gets replaced

The block-letter `BEZEL` you see where Claude Code normally prints its mascot is
not a Claude setting. It is a **pty output rewriter** that lives in bezel and
edits Claude's bytes on their way to the terminal.

This document covers what was changed, how to give it a custom design, and what
it would take to get it outside bezel.

---

## 1. What was actually changed

Two commits in `devkit-inc/bezel`:

| Commit | Date | What |
|---|---|---|
| `856199d` `feat(panes): show the bezel wordmark instead of Claude's mascot` | 2026-08-09 | The feature. `src/banner.ts` (new, 343 lines), `tests/banner.test.ts` (new), `electron/pty-manager.ts` (+14) |
| `e995d53` `fix(panes): restore the wordmark against claude 2.1.228's banner` | 2026-08-11 | Claude 2.1.228 repainted its banner and broke it in two ways. `src/banner.ts` (+73), `tests/banner.test.ts` (+95) |

Three files, total:

- **`src/banner.ts`** — the rewriter. Pure and browser-safe: takes a chunk of
  pty output, returns the chunk to actually render.
- **`tests/banner.test.ts`** — asserts on a *painted grid*, using bytes captured
  from a real Claude in a real pty. Two fixtures are pinned, one per Claude
  version (2.1.226 and 2.1.228), since either may be installed.
- **`electron/pty-manager.ts`** — wires it in.

The wiring is small enough to quote in full:

```ts
const rewriteBanner = role === 'claude' ? createBannerRewriter() : null
pty.onData(raw => {
  const d = rewriteBanner ? rewriteBanner(raw) : raw
  if (d === '') return
  // ...existing buffer + fan-out
})
```

Two deliberate details there:

- Only the `claude` pane gets a rewriter, so no other pane pays for the scan.
- It runs at the **top** of `onData`, so the rewritten bytes are what gets
  *buffered* as well as what gets fanned out. A warm spare pane adopted later
  replays its banner from that buffer — apply it downstream and the spare would
  replay the original mascot.
- The rewriter can legitimately return `''` (it holds a partial art row back
  until the rest of the run arrives), hence the empty-string guard.

---

## 2. Why it's a cursor tracker and not a regex

Worth understanding before you customize, because it constrains the design.

Claude's banner is **painted**, not printed. The captured bytes look like:

```
ESC[2;2H ▐▛███▜▌ ESC[3C Claude ESC[1C Code ESC[1C v2.1.226 CR LF
▝▜█████▛▘ ESC[2C Opus … ESC[4;3H ▘▘ ESC[1C ▝▝ ESC[4C ~\source
```

Which defeats line matching three ways:

1. The art is placed by CUP (`ESC[row;colH`), so it never begins a line — a
   `^`-anchored pattern never sees it.
2. The gaps are cursor-forward moves (`ESC[3C`), not spaces — *including the
   single spaces between words* of the info text.
3. One newline-delimited "line" holds two art rows plus the status bar, and the
   third art row arrives as **two separate runs** (`▘▘` then `▝▝`).

So `banner.ts` tokenizes the stream and tracks the cursor. That also buys the
thing a substitution otherwise can't have: the wordmark is 15 columns wide where
the mascot is 7, and re-emitting an absolute column (`ESC[…G`) after each art row
keeps all three info rows landing on one column regardless of the width change.

**The version / model / effort / cwd text is left exactly as Claude printed it.**
That's the whole reason this runs *downstream* of Claude rather than printing a
banner before it — those values aren't knowable ahead of time. No `model` key is
persisted to `settings.json`, and both `orgModelDefaultCache` and
`modelAccessCache` in `~/.claude.json` are `null`. The model is resolved at
runtime from the account.

Also note: Claude Code **cannot be told to hide its logo**. There is no flag, no
setting, and no environment variable — the only banner-related one is
`CLAUDE_CODE_FORCE_FULL_LOGO`, which forces the *larger* logo. Its `hideLogo` and
`hideWelcomeChrome` props are internal, default to `false`, and are only ever set
from other props.

---

## 3. Doing a custom design

Everything you need is in the constants at the top of `src/banner.ts`:

```ts
/** The wordmark, one row per mascot row. */
const WORDMARK = ['╔╗ ╔═╗╔═╗╔═╗╦', '╠╩╗║╣ ╔═╝║╣ ║', '╚═╝╚═╝╚═╝╚═╝╩═╝']

/** Widest wordmark row; every row is padded to it so the art has a flush edge. */
const ART_WIDTH = Math.max(...WORDMARK.map(r => r.length))

/** Left margin, matching the column Claude starts its own top row at. */
const START_COL = 2

/** Columns between the wordmark and the info text. */
const GAP = 3

const INFO_COL = START_COL + ART_WIDTH + GAP
```

### The rules

- **`WORDMARK` must have exactly 3 rows.** Claude's mascot is 3 rows, and rows
  are matched by `row - baseRow` against `WORDMARK.length`. Fewer than 3 and the
  mascot's feet stay on screen; more than 3 and the extras are never painted.
- **Width is free.** `ART_WIDTH` is derived and `INFO_COL` follows it, so any
  width realigns the info block automatically. Rows are `padEnd`-ed to the
  widest, so they don't have to match each other.
- **`START_COL` / `GAP`** are pure aesthetics — left margin and the gutter
  between art and the `Claude Code v… / Opus … / ~\source` text.
- Rows may contain **spaces** — they're padded before painting.

### What you must not break

`ART_RUN` / `GLYPH` describe *Claude's* mascot characters, not yours:

```ts
const ART_RUN = /^[▀▄█▌▐▖-▟ ]+$/
const GLYPH   = /[▀▄█▌▐▖-▟]/g
```

These are the **detector**. They match a character *class* rather than the exact
art on purpose: Claude assembles its logo per row from parts with four variants
(default, look-left, look-right, arms-up), so any literal string would match one
and miss three. Leave these alone unless Claude changes its glyphs. Your custom
art can use any characters at all — it's only ever *emitted*, never matched.

### Workflow

```powershell
cd C:\Users\testuser\source\orgs\devkit-inc\bezel
# edit WORDMARK in src/banner.ts
npx vitest run tests/banner.test.ts
```

The tests assert on a **painted grid**, not on bytes — absolute cursor moves mean
a byte-level check can pass while the screen is still wrong. They will tell you
if your art misaligns the info rows.

### When Claude updates

This is version-coupled. `e995d53` exists because 2.1.228 changed two things at
once:

- The mascot gained a **black interior** (`ESC[48;2;0;0;0m … ESC[49m`). The SET
  landed before the run anchored, the CLEAR landed *inside* the run where SGR
  was being dropped — so black bled across the wordmark, the info text and every
  row after. Fixed by *holding* SGR seen inside a run and replaying it after the
  art, with `closeArt` emitting `ESC[49m` first so set/clear stay balanced.
- The third row started arriving as ordinary spaced text (`" ▐"`,
  `"  ▘▘ ▝▝  "`), which a glyphs-only whole-token match skipped.

So: if a future Claude release makes the mascot reappear or the layout stagger,
capture the bytes from a real pty, pin them as a **third fixture** beside the
existing two, and adjust. Don't delete the old fixtures — either version may be
installed on a given machine.

---

## 4. Porting to the other machine

For **bezel specifically**, there is nothing to copy. It's committed to
`devkit-inc/bezel` on `main`:

```powershell
cd <repo root>\orgs\devkit-inc\bezel
git pull
npm install
npm run build      # or your usual dev/package step
```

Customize `WORDMARK` there and it applies on both machines once pushed.

---

## 5. Making it apply to *every* Claude, not just bezel

**Straight answer: the code above cannot do that, and it isn't a config change.**

The rewriter works because **bezel owns the pty**. It intercepts
`pty.onData` — bytes in flight between the Claude process and the terminal
emulator. In Windows Terminal, VS Code's terminal, or a bare `pwsh` window,
nothing sits in that position. Claude writes straight to the terminal and there
is no seam to insert into. And since Claude exposes no logo flag or env var
(§2), there's no configuration path either.

There are two real options.

### Option A — a `claude` wrapper that owns the pty (works everywhere, real work)

Build a small Node CLI that does what bezel does, minus Electron:

1. Spawn the real `claude` in a pty via `node-pty`.
2. Pipe its output through `createBannerRewriter()` — `src/banner.ts` is already
   **pure and dependency-free**, so it lifts out of bezel unchanged.
3. Pipe `stdin` back, forward `SIGWINCH`/resize, propagate the exit code.
4. Put the wrapper earlier on `PATH` than the real `claude`, or shadow it with a
   PowerShell function in `$PROFILE`.

Then it applies in every terminal on the machine.

Caveats, all of which have bitten this setup before:

- **`node-pty` must be a plain-Node build.** bezel's copy is compiled against
  Electron's ABI and will not load in a normal `node` process. Install a
  separate one for the wrapper.
- Steps 3 and 4 are where the effort actually is — raw mode, resize forwarding,
  Ctrl-C passthrough, and exit codes are what make a wrapper feel invisible
  rather than subtly broken.
- `claude-code`'s self-updater briefly leaves a shim with no exe behind it, so
  the wrapper needs to resolve and retry rather than preflight the binary.

### Option B — print your own banner before Claude starts (5 minutes, weaker)

A `$PROFILE` function that echoes your art, then runs `claude`:

```powershell
function claude {
    Write-Host @'
╔╗ ╔═╗╔═╗╔═╗╦
╠╩╗║╣ ╔═╝║╣ ║
╚═╝╚═╝╚═╝╚═╝╩═╝
'@ -ForegroundColor Cyan
    & claude.cmd @args
}
```

What you give up: Claude's mascot is **still there**, right below yours — this
adds, it does not replace. And your banner can't carry the version / model /
effort / cwd line, because none of it is knowable before Claude starts (§2).

---

## 6. Summary

| | |
|---|---|
| Where the design lives | `src/banner.ts`, the `WORDMARK` constant |
| Hard constraint | exactly 3 rows; width and characters are free |
| Don't touch | `ART_RUN` / `GLYPH` — those detect *Claude's* mascot |
| Verify with | `npx vitest run tests/banner.test.ts` |
| Port to another machine | `git pull` in `devkit-inc/bezel` — it's committed |
| Outside bezel | needs a pty-owning `claude` wrapper (Option A); no config path exists |
| Breaks when | Claude Code repaints its banner — capture a pty and add a fixture |
