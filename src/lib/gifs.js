// Klipy GIF search/trending — proxied through a small standalone Worker so
// the API key never reaches the browser (Firestore is the real backend for
// everything else; this Worker holds no app data). Requires the Worker to
// be reachable (wrangler dev locally, or the deployed Worker in production).
import { auth } from './firebase'

const WORKER_API_URL = import.meta.env.VITE_GIFS_WORKER_URL || 'http://127.0.0.1:8787'

async function workerFetch(path, idToken) {
  const res = await fetch(`${WORKER_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (!res.ok) throw new Error(`GIF request failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function idToken() {
  return auth.currentUser.getIdToken()
}

// Pick a good balance of quality vs. bandwidth: `sm.webp` for grid
// thumbnails, `hd.webp` for the actual sent message (still far smaller than
// the .gif variant at the same size, and we're only storing a URL either way).
export function gifThumbUrl(item) {
  return item.file?.sm?.webp?.url || item.file?.xs?.webp?.url
}

function bestSendFormat(item) {
  return item.file?.hd?.webp || item.file?.md?.webp || item.file?.hd?.gif || item.file?.md?.gif || null
}

export function gifSendUrl(item) {
  return bestSendFormat(item)?.url
}

// Firestore's setDoc rejects `undefined` field values outright (unlike
// `null`) — every field here must fall back to `null`, never leave a gap.
export function gifSendMeta(item) {
  const f = bestSendFormat(item)
  return {
    width: f?.width ?? null,
    height: f?.height ?? null,
    approxBytes: f?.size ?? null,
    originalName: item.title || item.slug || null,
  }
}

export async function searchGifs(query, page = 1) {
  const params = new URLSearchParams({ q: query, page })
  const res = await workerFetch(`/gifs/search?${params}`, await idToken())
  return res.data
}

export async function trendingGifs(page = 1) {
  const params = new URLSearchParams({ page })
  const res = await workerFetch(`/gifs/trending?${params}`, await idToken())
  return res.data
}
