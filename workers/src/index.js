// Punx Messenger — Klipy GIF proxy Worker.
//
// This is intentionally small: the only reason a server exists at all is to
// keep the Klipy API key off the browser (it's a URL path segment, not a
// header — see src/lib/gifs.js on the client). Firebase/Firestore is the
// real backend for everything else; this Worker holds no app data.

import { AuthError } from './auth.js'
import * as gifs from './routes/gifs.js'

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!allowed.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function withCors(response, cors) {
  for (const [k, v] of Object.entries(cors)) response.headers.set(k, v)
  return response
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (url.pathname === '/health') {
      return withCors(Response.json({ ok: true, ts: Date.now() }), cors)
    }

    try {
      if (url.pathname === '/gifs/search' && request.method === 'GET') {
        return withCors(await gifs.searchGifs(request, env), cors)
      }
      if (url.pathname === '/gifs/trending' && request.method === 'GET') {
        return withCors(await gifs.trendingGifs(request, env), cors)
      }
    } catch (err) {
      if (err instanceof AuthError) return withCors(Response.json({ error: err.message }, { status: err.status }), cors)
      console.error('[worker] unhandled error:', err)
      return withCors(Response.json({ error: 'Internal error' }, { status: 500 }), cors)
    }

    return withCors(new Response('Not found', { status: 404 }), cors)
  },
}
