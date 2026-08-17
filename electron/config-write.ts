import { writeFileSync, renameSync, unlinkSync } from 'fs'

/**
 * Replace a JSON file without ever leaving it half-written.
 *
 * `writeUserConfig` (electron-ui) does a plain `writeFileSync`, which truncates
 * and then writes. `project:remember` enters that window several times a minute,
 * and what is in the file is every layout preset the user has built plus the
 * directory the next launch opens at — `readUserConfig` returns `{}` on invalid
 * JSON, so a crash inside the window presents as bezel quietly forgetting
 * everything the user ever configured.
 *
 * Write-then-rename closes it: `rename` over an existing path is atomic, so a
 * reader sees either the old file or the new one and never a truncated one. The
 * temp lives NEXT TO the target rather than in the system temp dir, because a
 * cross-device rename degrades to a copy and is not atomic at all.
 *
 * Best-effort, matching the contract of the function it replaces: a config that
 * cannot be saved is not worth taking the app down for. The failure mode is
 * strictly better than the one it replaces, though — a failed write here loses
 * the NEW value, where a failed `writeFileSync` loses both.
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  try {
    // Serialized before the file is touched: a value JSON cannot represent must
    // fail without having opened anything.
    const json = JSON.stringify(data, null, 2)
    writeFileSync(tmp, json, 'utf-8')
    renameSync(tmp, file)
  } catch {
    // Leave no debris. A stale .tmp is harmless on its own, but it would be
    // read by nothing and cleaned by nothing.
    try { unlinkSync(tmp) } catch { /* never existed, or already gone */ }
  }
}
