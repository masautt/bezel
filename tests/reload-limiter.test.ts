import { describe, it, expect } from 'vitest'
import { createReloadLimiter } from '../electron/reload-limiter.js'

describe('reload limiter', () => {
  it('allows three reloads then stops', () => {
    let t = 0
    const limiter = createReloadLimiter({ max: 3, windowMs: 60_000, now: () => t })
    expect([limiter.allow(), limiter.allow(), limiter.allow()]).toEqual([true, true, true])
    expect(limiter.allow()).toBe(false)
  })

  it('forgets attempts older than the window', () => {
    let t = 0
    const limiter = createReloadLimiter({ max: 3, windowMs: 60_000, now: () => t })
    limiter.allow(); limiter.allow(); limiter.allow()
    t = 60_001
    expect(limiter.allow()).toBe(true)
  })
})
