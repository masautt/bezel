/**
 * Bounds crash recovery. A renderer that crashes during boot would otherwise
 * reload forever, and an unbounded recovery loop is a worse failure than the
 * crash it is recovering from — it burns CPU, rewrites config on every cycle,
 * and buries the original cause under identical log lines.
 */
export function createReloadLimiter(opts?: { max?: number; windowMs?: number; now?: () => number }) {
  const max = opts?.max ?? 3
  const windowMs = opts?.windowMs ?? 60_000
  const now = opts?.now ?? Date.now
  let stamps: number[] = []
  return {
    allow(): boolean {
      const t = now()
      stamps = stamps.filter(s => t - s < windowMs)
      if (stamps.length >= max) return false
      stamps.push(t)
      return true
    },
  }
}
