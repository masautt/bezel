#!/usr/bin/env node
// Rebuild + re-install the calling tool's packaged exe. Windows-only.
// Run from a tool's repo root: node node_modules/@devkit-inc/desktop-shell/scripts/reinstall.mjs --build <npm-script>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTargets, pickInstaller } from './reinstall-lib.mjs';

function fail(msg) {
  console.error(`reinstall: ${msg}`);
  process.exit(1);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (process.platform !== 'win32') {
  fail('reinstall is Windows-only (uses taskkill + NSIS /S).');
}

const args = process.argv.slice(2);
const bi = args.indexOf('--build');
const buildScript = bi !== -1 ? args[bi + 1] : undefined;
if (!buildScript) fail('missing required --build <npm-script>.');

const cwd = process.cwd();
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
} catch (e) {
  fail(`could not read package.json in ${cwd}: ${e.message}`);
}

let targets;
try {
  targets = resolveTargets(pkg);
} catch (e) {
  fail(e.message);
}
const { productName, output } = targets;
const outDir = path.join(cwd, output);
const exe = `${productName}.exe`;

function killApp() {
  // /F force, /IM image name; ignore failure (nothing running).
  spawnSync('taskkill', ['/IM', exe, '/F'], { stdio: 'ignore' });
}

// 1. Kill running instances so they don't lock the asar / installed exe.
killApp();

// 2. Clear the prior build, retrying through transient Defender/OS asar locks.
for (let attempt = 1; ; attempt += 1) {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    break;
  } catch (e) {
    if (attempt >= 5) {
      fail(
        `could not clear "${output}/" after 5 tries (${e.code || e.message}). ` +
          `Close all ${productName} instances, pause antivirus, and retry.`,
      );
    }
    sleepSync(750);
  }
}

// 3. Rebuild.
const build = spawnSync('npm', ['run', buildScript], { cwd, stdio: 'inherit', shell: true });
if (build.status !== 0) fail(`build (npm run ${buildScript}) failed with code ${build.status}.`);

// 4. Re-kill: the build took minutes; the user may have relaunched.
killApp();

// 5. Silent-install the newest matching installer.
let candidates = [];
try {
  candidates = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith(`${productName} Setup `) && f.endsWith('.exe'))
    .map((f) => {
      const p = path.join(outDir, f);
      return { path: p, mtimeMs: fs.statSync(p).mtimeMs };
    });
} catch (e) {
  fail(`could not read output dir "${output}/": ${e.message}`);
}

let installer;
try {
  installer = pickInstaller(candidates);
} catch (e) {
  fail(e.message);
}

const inst = spawnSync(installer, ['/S'], { stdio: 'inherit', shell: false });
if (inst.status !== 0) fail(`installer exited with code ${inst.status}.`);

// 6. Report.
console.log(`reinstall: ${productName} rebuilt and re-installed. Launch it from the Start Menu.`);
