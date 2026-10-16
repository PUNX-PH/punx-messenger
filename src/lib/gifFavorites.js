// Favorited GIFs — per account, per browser (localStorage), not synced across
// devices. Stores the full Klipy item so favorites redisplay without another
// network round-trip.
//
// Per ACCOUNT because a browser is not a person: it used to be one list for the
// whole browser, so anyone who signed in on a shared computer saw, and could
// change, the previous person's favorites.
//
// Every function takes the storage as its last argument so the tests can use a
// plain object; callers leave it out.
const LEGACY_KEY = 'punx.gifFavorites' // the one shared list this replaced
const keyFor = (uid) => `punx.gifFavorites.${uid}`
const MAX = 50

function defaultStorage() {
  try { return globalThis.localStorage } catch { return null }
}

// Whatever is in storage, as a clean list: a hand-edited or half-written value
// must give an empty list, not a crash in the GIF panel.
function parse(raw) {
  try {
    const list = JSON.parse(raw || '[]')
    return Array.isArray(list)
      ? list.filter(f => f && typeof f === 'object' && f.id !== undefined && f.id !== null)
      : []
  } catch { return [] }
}

function save(uid, list, storage) {
  try { storage?.setItem(keyFor(uid), JSON.stringify(list)) }
  catch { /* storage full/unavailable — non-fatal, favorites just won't persist */ }
}

/**
 * This account's favorites, newest first.
 *
 * The first account to look after the upgrade adopts the old shared list (it
 * belongs to somebody, and is better kept than dropped), and the shared copy is
 * removed so no one else inherits it.
 */
export function getFavorites(uid, storage = defaultStorage()) {
  if (!uid || !storage) return []
  try {
    const own = storage.getItem(keyFor(uid))
    if (own !== null) return parse(own)
    const legacy = storage.getItem(LEGACY_KEY)
    if (legacy === null) return []
    const adopted = parse(legacy)
    save(uid, adopted, storage)
    storage.removeItem(LEGACY_KEY)
    return adopted
  } catch { return [] }
}

export function isFavorited(favorites, id) {
  return favorites.some(f => f.id === id)
}

// Returns the updated list so callers can setState directly with the result.
export function toggleFavorite(uid, item, storage = defaultStorage()) {
  const favorites = getFavorites(uid, storage)
  if (!uid) return favorites
  const next = isFavorited(favorites, item.id)
    ? favorites.filter(f => f.id !== item.id)
    : [item, ...favorites].slice(0, MAX)
  save(uid, next, storage)
  return next
}
