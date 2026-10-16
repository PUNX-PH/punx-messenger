import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../lib/auth'
import {
  clearDataProblems, describeProblems, getDataProblems, subscribeDataProblems,
} from '../lib/dataHealth'

/**
 * Says so when part of the app stopped receiving live data (see lib/dataHealth.js).
 * Without it a failed feed looks exactly like an empty one: a missing group list,
 * a DM list that never fills, people who never show as online.
 *
 * Mounted once, beside the routes, so it outlives sign-in and sign-out. Reloading
 * is the retry: a failed Firestore listener is finished for good.
 */
export default function DataProblemsBanner() {
  const problems = useSyncExternalStore(subscribeDataProblems, getDataProblems, () => [])
  const { user, profile } = useAuth()
  const uid = user?.uid
  const [dismissed, setDismissed] = useState('')

  // A different person (or nobody) is not the same session: forget the last one's
  // failures. Not on first render, so errors raised before this mounted survive.
  const lastUid = useRef(uid)
  useEffect(() => {
    if (lastUid.current === uid) return
    lastUid.current = uid
    clearDataProblems()
    setDismissed('')
  }, [uid])

  if (!profile || !problems.length) return null

  // Dismissing hides exactly these problems; a new one shows again.
  const fingerprint = problems.map((p) => p.key).sort().join('|')
  if (dismissed === fingerprint) return null

  return (
    <div
      role="alert"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] max-w-[calc(100vw-2rem)] w-max flex items-start gap-3 rounded-lg border border-line-subtle bg-bg-raised px-4 py-3 text-sm text-ink shadow-elev2"
    >
      <span className="min-w-0">{describeProblems(problems)}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 px-2.5 py-0.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setDismissed(fingerprint)}
        aria-label="Dismiss"
        className="shrink-0 text-ink-dim hover:text-ink transition-colors"
      >
        ×
      </button>
    </div>
  )
}
