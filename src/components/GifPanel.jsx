import { useEffect, useState } from 'react'
import { searchGifs, trendingGifs, gifThumbUrl, gifSendUrl, gifSendMeta } from '../lib/gifs'
import { getFavorites, isFavorited, toggleFavorite } from '../lib/gifFavorites'

/**
 * Discord-style GIF search tab, backed by Klipy (proxied through the Worker
 * so the API key stays server-side). Picking a GIF sends it immediately —
 * see Composer.jsx's sendGif, not insertAtCursor.
 */
export default function GifPanel({ onPick }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('trending') // 'trending' | 'favorites' — ignored while searching
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [favorites, setFavorites] = useState(() => getFavorites())

  useEffect(() => {
    let cancelled = false
    const delay = query.trim() ? 350 : 0
    const t = setTimeout(() => {
      setLoading(true); setError(null)
      const run = query.trim() ? searchGifs(query.trim()) : trendingGifs()
      run
        .then((data) => { if (!cancelled) setItems(data?.data || []) })
        .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load GIFs.') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, delay)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const pick = (item) => {
    onPick(gifSendUrl(item), gifSendMeta(item))
  }

  const onToggleFavorite = (e, item) => {
    e.stopPropagation()
    setFavorites(toggleFavorite(item))
  }

  const searching = Boolean(query.trim())
  const displayItems = !searching && mode === 'favorites' ? favorites : items

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-2 border-b border-line-subtle bg-bg-deepest">
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search GIFs"
          className="w-full h-7 bg-bg-raised text-sm rounded-sm px-2 outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {!searching && (
        <div className="flex gap-1 px-2 pt-2">
          <ModeButton active={mode === 'trending'} onClick={() => setMode('trending')}>Trending</ModeButton>
          <ModeButton active={mode === 'favorites'} onClick={() => setMode('favorites')}>★ Favorites</ModeButton>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin max-h-72 p-2">
        {error ? (
          <div className="p-4 text-center text-xs text-bad">{error}</div>
        ) : loading && !searching && mode === 'trending' && displayItems.length === 0 ? (
          <div className="p-4 text-center text-xs text-ink-muted">Loading…</div>
        ) : displayItems.length === 0 ? (
          <div className="p-4 text-center text-xs text-ink-muted">
            {!searching && mode === 'favorites' ? 'No favorites yet — tap the star on any GIF to save it here.' : 'No GIFs found.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {displayItems.map(item => {
              const fav = isFavorited(favorites, item.id)
              return (
                <div key={item.id} className="relative group/gif">
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    title={item.title}
                    className="w-full aspect-square block rounded overflow-hidden bg-bg-deepest hover:ring-2 hover:ring-brand transition-all"
                  >
                    <img src={gifThumbUrl(item)} alt={item.title || ''} className="w-full h-full object-cover" loading="lazy" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => onToggleFavorite(e, item)}
                    title={fav ? 'Remove from favorites' : 'Add to favorites'}
                    className={[
                      'absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-black/60 transition-opacity',
                      fav ? 'text-yellow-400 opacity-100' : 'text-white/80 opacity-0 group-hover/gif:opacity-100',
                    ].join(' ')}
                  >
                    <StarIcon filled={fav} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-line-subtle text-[10px] text-ink-dim text-right">
        Powered by Klipy
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'text-[11px] font-medium px-2 py-1 rounded-full transition-colors',
        active ? 'bg-brand text-white' : 'text-ink-dim hover:text-ink hover:bg-bg-hover',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function StarIcon({ filled }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
