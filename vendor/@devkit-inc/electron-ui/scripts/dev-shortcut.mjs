#!/usr/bin/env node
// Create/update the "<productName> (dev)" Start-Menu shortcut that launches this
// tool's live-HMR build (dev-hidden.vbs). Windows-only. Run from a tool's repo root:
//   node node_modules/@devkit-inc/desktop-shell/scripts/dev-shortcut.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveShortcutName, buildShortcutPs } from './dev-shortcut-lib.mjs';

function fail(msg) {
  console.error(`dev-shortcut: ${msg}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  fail('dev-shortcut is Windows-only (creates a Start-Menu .lnk via WScript.Shell).');
}

const cwd = process.cwd();

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
} catch (e) {
  fail(`could not read package.json in ${cwd}: ${e.message}`);
}

let name;
try {
  name = resolveShortcutName(pkg);
} catch (e) {
  fail(e.message);
}

const targetVbs = path.join(cwd, 'dev-hidden.vbs');
if (!fs.existsSync(targetVbs)) {
  fail(
    `no dev-hidden.vbs in ${cwd}. Add it (it should run "npm run electron:hmr") before creating the shortcut.`,
  );
}

// Optional icon from build.win.icon (relative to the repo root).
const iconRel = pkg.build && pkg.build.win && pkg.build.win.icon;
const iconPath =
  iconRel && fs.existsSync(path.join(cwd, iconRel)) ? path.join(cwd, iconRel) : undefined;

const appData = process.env.APPDATA;
if (!appData) fail('APPDATA is not set; cannot locate the Start Menu.');
const programs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const lnkPath = path.join(programs, `${name}.lnk`);

const wscriptPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');

const psCommand = buildShortcutPs({ lnkPath, wscriptPath, targetVbs, workingDir: cwd, iconPath });

const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
  stdio: 'inherit',
  shell: false,
});
if (res.status !== 0) fail(`PowerShell exited with code ${res.status}.`);

console.log(`dev-shortcut: created "${name}". Search the Start Menu for "${name}".`);
