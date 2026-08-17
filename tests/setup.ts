// Minimal jsdom test setup for React Testing Library. Without this, RTL's
// auto-cleanup never registers (it only self-wires when it detects a global
// `afterEach`, and this project imports test functions explicitly rather than
// using vitest's globals), so renders from one test leak into the next and
// duplicate-node queries fail.
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
// Registers matchers like toBeInTheDocument/toHaveAttribute/toHaveClass on
// Vitest's `expect`. Installed already, but nothing wired it in until now.
import '@testing-library/jest-dom/vitest'
import { deriveRoots } from '@shared/roots'

// ContextProvider calls project.last() on mount to seed its remembered repo, so
// every suite that renders it — not just the ones that care about persistence —
// needs these to exist. Seeded fresh per test so call-count assertions are
// meaningful, and spread over whatever a suite has already stubbed so the
// existing `{ ...window.bezel, git: … }` pattern keeps working.
// Guarded on `window`: this setup file also runs for the suites that declare a
// node environment (zoom-neutral.test.ts reads package.json, not the DOM), and
// an unguarded assignment throws there before a single test runs.
beforeEach(() => {
  if (typeof window === 'undefined') return
  window.bezel = {
    ...window.bezel,
    // ContextProvider, TabStrip, App and ContextWidget read these during render
    // (the preload supplies them as a plain value, not an invoke), so a suite
    // that renders any of them needs them present before the first render.
    // Seeded to match the C:/Users/testuser/... fixtures the suites already use, so
    // resolution keeps working. That these are FIXTURES rather than a value the
    // app knows is the point of the change: paths.test.ts derives from a
    // different home entirely and gets the same behavior.
    roots: deriveRoots('C:/Users/testuser'),
    project: {
      remember: vi.fn().mockResolvedValue(undefined),
      rememberRepo: vi.fn().mockResolvedValue(undefined),
      last: vi.fn().mockResolvedValue({ cwd: 'C:/Users/testuser/source', repoRoot: null }),
      // Every restored tab's cwd exists by default, so a suite that renders
      // App without caring about the missing-directory path keeps booting its
      // tabs exactly as before.
      exists: vi.fn().mockResolvedValue(true),
      // Likewise: every remembered session has a transcript by default, so a
      // suite that does not care about the ghost-session path keeps resuming
      // exactly as before.
      sessionExists: vi.fn().mockResolvedValue(true),
    },
    clipboard: {
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(''),
    },
    // App loads the layout store and pulls presets on mount, so every suite
    // that renders it needs these present. `load` resolving to null is the
    // first-run path; `pull` resolving to null is the "Supabase unavailable"
    // path, which must leave the app fully working.
    layout: {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    },
    presets: {
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(true),
      tombstone: vi.fn().mockResolvedValue(true),
    },
    // App reads this on mount to restore the remembered tab set, and writes
    // to it on every tab change. `last` resolving to null is the "nothing
    // remembered" path, which falls through to the same project.last() flow
    // every suite already exercises.
    tabs: {
      remember: vi.fn().mockResolvedValue(undefined),
      last: vi.fn().mockResolvedValue(null),
    },
  } as typeof window.bezel
})

afterEach(() => { cleanup() })
