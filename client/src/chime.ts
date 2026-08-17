// The sound half of "this session is ready for you". Synthesized rather than
// shipped as an asset: two sine blips are a few lines of WebAudio, and a bundled
// .wav would be one more file in the build config, one more thing electron-
// builder has to unpack, and a fixed timbre nobody can tune from here.
//
// Deliberately NOT xterm's own bell audio (`bellStyle: 'sound'`, which plays a
// harsh built-in beep on every BEL): this fires only when the bell is actually
// news — see App's onBell, which is gated on the tab being unwatched. Nothing
// plays while you are looking at the pane that rang.

/** Persisted per machine, not per theme preset: it is about this desk, not this layout. */
const KEY = 'bezel.chime'

/** Default ON. Only an explicit opt-out is stored, so a cleared profile chimes. */
export function chimeEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    // Storage can throw outright under some profile/permission setups; a
    // preference read must never be the thing that breaks a bell.
    return true
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* ignore — the sound just does not persist across restarts */
  }
}

/**
 * Lazily built and then reused. Constructing an AudioContext per ring leaks one
 * per bell (browsers cap them, and hitting the cap makes every later one throw),
 * and building it at module scope would create it before any user gesture, which
 * lands it in the `suspended` state.
 */
let ctx: AudioContext | null = null

/** A soft two-note rise. Quiet on purpose: this sits beside you all day. */
const NOTES: { hz: number; at: number }[] = [
  { hz: 880, at: 0 },      // A5
  { hz: 1318.5, at: 0.09 }, // E6
]
const PEAK = 0.055
const DECAY = 0.22

/**
 * Play the ready sound, if it is switched on. Fire-and-forget and fully
 * swallowed: under jsdom there is no AudioContext at all, and on a machine with
 * no output device `resume()` rejects — neither is a reason for a tab's bell to
 * throw through React's event handler.
 */
export function playChime(): void {
  if (!chimeEnabled()) return
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    // Autoplay policy parks a context created before the first gesture; by the
    // time a session has run long enough to ring, the user has clicked
    // something, so resuming here is enough and needs no gesture listener.
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const { hz, at } of NOTES) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      // An exponential ramp to a true zero is undefined, hence the epsilon —
      // and the 0.001s attack is what keeps the note's onset from clicking.
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.exponentialRampToValueAtTime(PEAK, now + at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + DECAY)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + at)
      osc.stop(now + at + DECAY + 0.02)
    }
  } catch {
    /* no audio here — the tab still pulses */
  }
}
