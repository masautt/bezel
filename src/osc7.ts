import { normalizePath } from './paths.js'

// OSC 7 payload shape: file://<host>/<path>. The host segment is optional and
// ignored — we only ever consume this from a local pty.
const FILE_URL = /^file:\/\/[^/]*\/(.+)$/

export function parseOsc7(payload: string): string | null {
  const match = FILE_URL.exec(payload.trim())
  if (!match) return null
  let path = match[1]
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  const normalized = normalizePath(path)
  if (!normalized) return null
  return normalized
}
