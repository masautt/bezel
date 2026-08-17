// Shared electron-builder afterPack hook. electron-builder copies a file:-symlinked
// dependency's WHOLE target dir into the app.asar (ignoring the dep's files:["dist"]),
// so @devkit-inc/electron-ui would otherwise drag its docs/src/tests in. This trims the
// shell inside the asar down to dist/ + package.json.
//
// Each consumer's electron-builder.config.cjs reduces to:
//   const { build } = require('./package.json');
//   module.exports = { ...build, afterPack: require('@devkit-inc/electron-ui/afterpack') };
//
// @electron/asar is a dependency of THIS package (not the consumer): the hook runs from
// the symlink realpath, so it can't resolve the consumer's electron-builder copy.
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

module.exports = async function trimShellInAsar(context) {
  const appAsar = path.join(context.appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(appAsar)) return;
  const tmp = path.join(context.appOutDir, 'resources', '.asar-trim');
  fs.rmSync(tmp, { recursive: true, force: true });
  asar.extractAll(appAsar, tmp);
  const pkg = path.join(tmp, 'node_modules', '@masautt', 'desktop-shell');
  if (fs.existsSync(pkg)) {
    for (const entry of fs.readdirSync(pkg)) {
      if (entry !== 'dist' && entry !== 'package.json') {
        fs.rmSync(path.join(pkg, entry), { recursive: true, force: true });
      }
    }
  }
  await asar.createPackage(tmp, appAsar);
  fs.rmSync(tmp, { recursive: true, force: true });
};
