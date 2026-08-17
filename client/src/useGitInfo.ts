import { useEffect, useState } from 'react'
import type { GitInfo } from '@shared/types'

// Polls while the window is focused. Ten seconds is slow enough to be free and
// fast enough that a commit in the shell pane shows up before you look away.
//
// Three states, for the same reason specsViewState carries three: `undefined` =
// not read yet, `null` = unreadable, and a GitInfo = a real answer. Seeding an
// empty GitInfo instead made "still loading" and "failed" both indistinguishable
// from "clean", so the first paint of every repo asserted it was clean before
// the status call had resolved.
export function useGitInfo(root: string | null): GitInfo | null | undefined {
  const [info, setInfo] = useState<GitInfo | null | undefined>(undefined)

  useEffect(() => {
    if (!root) { setInfo(null); return }
    let alive = true
    setInfo(undefined)
    const load = () => {
      void window.bezel.git.info(root)
        .then(next => { if (alive) setInfo(next) })
        .catch(() => { if (alive) setInfo(null) })
    }
    load()
    const timer = setInterval(() => { if (document.hasFocus()) load() }, 10000)
    return () => { alive = false; clearInterval(timer) }
  }, [root])

  return info
}
