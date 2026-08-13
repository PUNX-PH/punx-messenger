// Favorited GIFs — per-browser only (localStorage), not synced across
// devices. Stores the full Klipy item so favorites redisplay without another
// network round-trip.
const KEY = 'punx.gifFavorites'
const MAX = 50

export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') }
  catch { return [] }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) }
  catch { /* storage full/unavailable — non-fatal, favorites just won't persist */ }
}

export function isFavorited(favorites, id) {
  return favorites.some(f => f.id === id)
}

// Returns the updated list so callers can setState directly with the result.
export function toggleFavorite(item) {
  const favorites = getFavorites()
  const next = isFavorited(favorites, item.id)
    ? favorites.filter(f => f.id !== item.id)
    : [item, ...favorites].slice(0, MAX)
  save(next)
  return next
}
