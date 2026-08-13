import { verifyAuth, AuthError } from '../auth.js'

// Klipy's API key is embedded in the URL path itself (not a header), so this
// stays entirely server-side — never expose env.KLIPY_API_KEY to the client.
const KLIPY_BASE = 'https://api.klipy.com/api/v1'
const CUSTOMER_ID = 'punx-messenger'

async function klipyFetch(env, path, params) {
  const url = new URL(`${KLIPY_BASE}/${env.KLIPY_API_KEY}${path}`)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
  const res = await fetch(url)
  if (!res.ok) throw new AuthError(`Klipy request failed: ${res.status}`, 502)
  return res.json()
}

export async function searchGifs(request, env) {
  await verifyAuth(request, env)
  const url = new URL(request.url)
  const q = url.searchParams.get('q') || ''
  const page = url.searchParams.get('page') || '1'
  const data = await klipyFetch(env, '/gifs/search', { q, page, per_page: 24, customer_id: CUSTOMER_ID })
  return Response.json(data)
}

export async function trendingGifs(request, env) {
  await verifyAuth(request, env)
  const url = new URL(request.url)
  const page = url.searchParams.get('page') || '1'
  const data = await klipyFetch(env, '/gifs/trending', { page, per_page: 24, customer_id: CUSTOMER_ID })
  return Response.json(data)
}
