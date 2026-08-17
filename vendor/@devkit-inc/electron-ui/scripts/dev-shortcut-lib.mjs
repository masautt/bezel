// Pure, side-effect-free helpers for dev-shortcut.mjs (so they're unit-testable).

/** Build the "<productName> (dev)" shortcut base name from a parsed package.json. */
export function resolveShortcutName(pkg) {
  const productName = pkg && pkg.build && pkg.build.productName;
  if (!productName) {
    throw new Error('package.json "build.productName" is required for dev-shortcut');
  }
  return `${productName} (dev)`;
}

/** Single-quote a value for PowerShell, doubling embedded single quotes. */
function psStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Build the PowerShell command that creates/overwrites a .lnk via WScript.Shell.
 * The shortcut launches `wscript.exe "<targetVbs>"` (hidden console) from workingDir.
 * iconPath is optional; when falsy, IconLocation is left at its default.
 */
export function buildShortcutPs({ lnkPath, wscriptPath, targetVbs, workingDir, iconPath }) {
  if (!lnkPath || !wscriptPath || !targetVbs || !workingDir) {
    throw new Error('buildShortcutPs requires lnkPath, wscriptPath, targetVbs, and workingDir');
  }
  const lines = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psStr(lnkPath)})`,
    `$s.TargetPath = ${psStr(wscriptPath)}`,
    `$s.Arguments = ${psStr(`"${targetVbs}"`)}`,
    `$s.WorkingDirectory = ${psStr(workingDir)}`,
  ];
  if (iconPath) lines.push(`$s.IconLocation = ${psStr(iconPath)}`);
  lines.push('$s.Save()');
  return lines.join('\n');
}
