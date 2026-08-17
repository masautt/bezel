#!/usr/bin/env node
// Regression guard for the sandboxed-preload trap (see 0.2.1): a preload that
// requires this package fails to load under Electron's default sandbox, which
// silently drops the window.<app> bridge — including isElectron and the title
// bar. The main process still launches, so "did it start" checks pass. This
// script launches an app with ELECTRON_ENABLE_LOGGING and FAILS if the preload
// could not load.
//
// Usage:  node scripts/smoke-preload.mjs -- <command> [args...]
//   dev:       node scripts/smoke-preload.mjs -- npx electron .
//   packaged:  node scripts/smoke-preload.mjs -- "./release/app 0.1.0.exe"
// Env: SMOKE_WAIT_MS (default 12000) — how long to watch before deciding.
import { spawn, execSync } from 'node:child_process';

const sep = process.argv.indexOf('--');
const cmd = sep === -1 ? [] : process.argv.slice(sep + 1);
if (!cmd.length) {
  console.error('usage: node scripts/smoke-preload.mjs -- <command> [args...]');
  process.exit(2);
}

const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 12000);
const FAIL = /Unable to load preload script|module not found: @masautt\/desktop-shell/i;

const child = spawn(cmd[0], cmd.slice(1), {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  shell: true,
});

let out = '';
const collect = (d) => { out += d.toString(); };
child.stdout.on('data', collect);
child.stderr.on('data', collect);

function killTree(pid) {
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

setTimeout(() => {
  killTree(child.pid);
  if (FAIL.test(out)) {
    const line = out.split('\n').find((l) => FAIL.test(l));
    console.error('FAIL: preload did not load — window.<app> bridge (incl. title bar) is missing.');
    if (line) console.error('  ' + line.trim());
    process.exit(1);
  }
  console.log('OK: no preload-load error detected within ' + WAIT_MS + 'ms.');
  process.exit(0);
}, WAIT_MS);
