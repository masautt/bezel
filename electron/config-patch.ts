/**
 * electron-ui's writeUserConfig does a whole-file replace, not a merge. With a
 * single key in config.json that was harmless; with two it is a race that the
 * OSC 7 handler wins several times a minute, erasing whatever the other handler
 * wrote. Read-spread-write instead.
 *
 * Not pushed upstream: readUserConfig/writeUserConfig are a deliberate
 * read/write pair, and giving writeUserConfig merge semantics would silently
 * change behavior for every existing caller across four apps.
 *
 * `read` and `write` are injected rather than closed over so this stays
 * testable without an Electron `app` object.
 */
export function patchConfig<T extends object>(
  read: () => T,
  write: (next: T) => void,
  patch: Partial<T>
): void {
  write({ ...read(), ...patch })
}
