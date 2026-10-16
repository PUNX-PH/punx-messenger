// Loading parts of the app on demand: a loader that can be warmed up early, and
// that copes with the one thing that goes wrong with on-demand loading.
//
// What goes wrong. Every deploy renames the built files (their names carry a
// hash of their contents) and deletes the old ones. A tab left open since before
// the deploy still holds the OLD names, so the first time it asks for a part it
// has not loaded yet, the request 404s and the part never arrives. Without
// handling, that reaches an error boundary, and the one at the top of the app
// replaces everything, which ends a call or a voice session in progress. So a
// failed load is recognised, can be retried, and is reported by the small local
// boundary in components/LazySlot.jsx instead.
import { lazy } from 'react'

/** Messages browsers use when a dynamic import's file could not be fetched. */
const CHUNK_ERROR = /dynamically imported module|importing a module script failed|loading chunk|loading css chunk|failed to fetch/i

/** True when `error` is "the file for this part of the app could not be loaded". */
export const isChunkLoadError = (error) =>
  !!error && (error.name === 'ChunkLoadError' || CHUNK_ERROR.test(String(error.message || error)))

/**
 * React.lazy, plus `.preload()` to fetch the part ahead of time, and a retry:
 * a load that failed is forgotten, so the next attempt (or the "Try again" button)
 * actually asks again instead of replaying the same rejected promise forever.
 */
export function lazyWithPreload(factory) {
  let pending = null
  const load = () => {
    if (!pending) {
      pending = factory().catch((error) => {
        pending = null // do not cache a failure
        throw error
      })
    }
    return pending
  }
  const Component = lazy(load)
  Component.preload = load
  return Component
}

/**
 * Fetches parts the person is likely to want soon, while the browser is idle, so
 * the first time they open the emoji picker or a voice room it is already there.
 * Failures are swallowed: this is an optimisation, and the real attempt (with its
 * visible error handling) happens when the part is actually used.
 */
export function preloadWhenIdle(components, { after = 2000 } = {}) {
  const run = () => components.forEach(c => c.preload().catch(() => {}))
  const g = typeof window === 'undefined' ? globalThis : window
  const ric = g.requestIdleCallback
  // Wait a moment first: the app's own first paint and data come before anything
  // speculative, and idle time right after load is rarely idle.
  const start = () => (typeof ric === 'function' ? ric.call(g, run, { timeout: 10_000 }) : setTimeout(run, 0))
  const id = setTimeout(start, after)
  return () => clearTimeout(id)
}
