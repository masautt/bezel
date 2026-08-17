// electron-builder config lives in package.json "build" so the shared
// reinstall script (electron-ui/scripts/reinstall.mjs) can read productName and
// the output dir from there, matching localhub/masaudit/storybook.
const { build } = require('./package.json');

module.exports = {
  ...build,
  // bezel DOES ship a native node-pty inside its asar (see `asarUnpack`), so the
  // warning carried in localhub/storybook — "NOT safe to copy into bezel" — used to
  // be true. It is now stale, for the same reason the README's VC++ prerequisite is:
  // node-pty 1.1.0 is N-API (node-addon-api ^7.1.0), not NAN. N-API is ABI-stable
  // across Node and Electron, so there is nothing to re-link against Electron's ABI —
  // the binary that ships is the binary that runs. node-pty ships a complete
  // prebuilds/win32-x64 (pty.node, conpty*, winpty*) and lib/utils.js resolves
  // 'build/Release' -> 'build/Debug' -> 'prebuilds/<platform>-<arch>', so the empty
  // build/Release falls through to the prebuild.
  //
  // Left true, electron-builder runs @electron/rebuild unconditionally, which shells
  // out to node-gyp and hard-fails with "Could not find any Visual Studio installation"
  // on any box without VC++ build tools — a compile whose only possible output is a
  // byte-identical replacement for a prebuild that already works.
  npmRebuild: false,
};
