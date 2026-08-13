import { useEffect, useState } from 'react'
import { searchGifs, trendingGifs, gifThumbUrl, gifSendUrl, gifSendMeta } from '../lib/gifs'

/**
 * Discord-style GIF search tab, backed by Klipy (proxied through the Worker
 * so the API key stays server-side). Picking a GIF sends it immediately —
 * see Composer.jsx's sendGif, not insertAtCursor.
 */
export default function GifPanel({ onPick }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

      <div className="flex-1 overflow-y-auto scrollbar-thin max-h-72 p-2">
        {error ? (
          <div className="p-4 text-center text-xs text-bad">{error}</div>
        ) : loading && items.length === 0 ? (
          <div className="p-4 text-center text-xs text-ink-muted">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-center text-xs text-ink-muted">No GIFs found.</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => pick(item)}
                title={item.title}
                className="rounded overflow-hidden bg-bg-deepest hover:ring-2 hover:ring-brand transition-all aspect-square"
              >
                <img src={gifThumbUrl(item)} alt={item.title || ''} className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-line-subtle text-[10px] text-ink-dim text-right">
        Powered by Klipy
      </div>
    </div>
  )
}
