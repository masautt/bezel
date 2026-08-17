// Pure, side-effect-free helpers for reinstall.mjs (so they're unit-testable).

/** Read productName + output dir from a parsed package.json's `build` block. */
export function resolveTargets(pkg) {
  const build = (pkg && pkg.build) || {};
  const productName = build.productName;
  if (!productName) {
    throw new Error('package.json "build.productName" is required for reinstall');
  }
  const output = (build.directories && build.directories.output) || 'release';
  return { productName, output };
}

/** Pick the newest installer from candidates [{ path, mtimeMs }]; throw if none. */
export function pickInstaller(candidates) {
  if (!candidates || candidates.length === 0) {
    throw new Error('no NSIS installer (<productName> Setup *.exe) found in the output dir');
  }
  return [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs)[0].path;
}
