import { useEffect, useRef, useState } from 'react'
import {
  BUILTIN_LOADING_MESSAGES,
  LOADING_CACHE_KEY,
  normalizeMessages,
  pickIndex,
  type LoadingMessage,
} from '@shared/loading-messages'

/** How long a line stays up. Long enough to read, short enough that the ~8s
 *  launch wait shows three of them. */
const ROTATE_MS = 2500

/**
 * The cached remote set, or the built-ins.
 *
 * Read SYNCHRONOUSLY, in a useState initializer, and deliberately not over IPC.
 * While main is inside a synchronous nodePty.spawn — which is the entire reason
 * this screen exists — any invoke the renderer sends queues behind it and cannot
 * answer until the wait is already over. localStorage is renderer-local and
 * needs no await, so there is a message on the very first paint.
 *
 * Falls back whenever the cache yields nothing usable, so a corrupt or
 * half-written blob degrades to the built-ins instead of an empty screen.
 */
function loadMessages(): LoadingMessage[] {
  try {
    const cached = normalizeMessages(JSON.parse(window.localStorage.getItem(LOADING_CACHE_KEY) ?? 'null'))
    if (cached.length > 0) return cached
  } catch {
    // Unavailable (private mode, disabled storage) or unparseable. Neither is
    // worth reporting from a loading screen.
  }
  return [...BUILTIN_LOADING_MESSAGES]
}

export interface LoadingScreenProps {
  /** Shown under the message. Omitted while the shell itself is still resolving. */
  detail?: string
}

/**
 * The window's launch screen, covering the shell until both of the first tab's
 * panes have live ptys.
 *
 * It replaces an interval — roughly 6s to 14s on this machine — during which
 * bezel painted its full UI and then ignored every click, because main was
 * blocked spawning ptys and could not answer a single IPC call. A UI you can see
 * and cannot use reads as a crash; this reads as work.
 *
 * Everything here runs in the RENDERER, which is a separate process from the
 * blocked one and keeps painting throughout. That is what makes an animated
 * screen possible at all without first moving pty spawning off the main thread.
 */
export function LoadingScreen({ detail }: LoadingScreenProps) {
  // Resolved once per mount rather than per render: re-reading localStorage on
  // every rotation would be pointless work, and the set must not change under
  // the rotation while a line is on screen.
  const [messages] = useState(loadMessages)
  const [index, setIndex] = useState(() => pickIndex(messages, Math.random()))
  // The rotation reads the CURRENT index to avoid repeating it, but must not
  // restart its timer every time that index changes — an effect keyed on it
  // would reset the interval on each tick and drift.
  const indexRef = useRef(index)
  indexRef.current = index

  useEffect(() => {
    if (messages.length < 2) return
    const timer = setInterval(() => {
      setIndex(pickIndex(messages, Math.random(), indexRef.current))
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [messages])

  const text = index >= 0 ? messages[index].text : ''

  return (
    // aria-live so a screen reader announces the rotating line; role=status
    // rather than alert because this is progress, not a problem.
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen-inner">
        <div className="loading-brand">bezel</div>
        {/* Keyed by index so React remounts the line and the fade-in replays;
            without the key it would swap text in place with no transition. */}
        <div className="loading-message" key={index}>
          {text}
          <span className="loading-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        {detail ? <div className="loading-detail">{detail}</div> : null}
      </div>
    </div>
  )
}
