// Which of the app's live data feeds have failed, so the app can say so.
//
// A Firestore listener that fails is finished: it never delivers again, and
// whatever it fed (the people list, your groups, the DM list...) just stays as it
// was, silently, until the page is reloaded. Each such listener reports here, and
// one banner (DataProblemsBanner) tells the person, instead of nine screens
// each inventing their own wording.
//
//   onSnapshot(query, ...watched('people', snap => { ... }))
//
// "watched" returns the success and error callbacks for onSnapshot. A success
// clears that feed's problem (it only matters if a listener is replaced by a
// fresh one, which is what reloading does).

const problems = new Map() // key -> { key, label, code }
let snapshot = []          // the same array until something changes (what React compares)
const listeners = new Set()

function publish() {
  snapshot = [...problems.values()]
  listeners.forEach((fn) => fn())
}

/** key: one per feed (e.g. "group:abc"); label: what to call it to the person. */
export function reportDataError(key, label, err) {
  const code = String(err?.code || '').replace(/^firestore\//, '')
  const before = problems.get(key)
  if (before && before.code === code && before.label === label) return
  problems.set(key, { key, label, code })
  publish()
}

export function reportDataOk(key) {
  if (problems.delete(key)) publish()
}

/** For when who is signed in changes: the old person's failures are not the new one's. */
export function clearDataProblems() {
  if (!problems.size) return
  problems.clear()
  publish()
}

export const getDataProblems = () => snapshot

export function subscribeDataProblems(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * The two callbacks for onSnapshot(ref, next, error), as an array to spread.
 * "key" defaults to the label; give one when the same kind of feed exists per
 * group or per channel, so two failures are not merged into one.
 */
export function watched(label, next, key = label) {
  return [
    (...args) => { reportDataOk(key); return next(...args) },
    (err) => {
      console.error(`[data] "${label}" stopped updating:`, err)
      reportDataError(key, label, err)
    },
  ]
}

/**
 * The sentence for the banner.
 * @param {Array<{label: string, code: string}>} list
 */
export function describeProblems(list) {
  if (!list.length) return ''
  const labels = [...new Set(list.map((p) => p.label))]
  const names = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  const denied = list.some((p) => p.code === 'permission-denied')
  return `Couldn't keep ${names} up to date, so what you see may be out of date.`
    + (denied ? ' You may no longer have access to some of it.' : '')
}
