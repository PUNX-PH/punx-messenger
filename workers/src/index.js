// Punx Messenger API — Cloudflare Worker entry point.
//
// Phase 0: just a health check, to prove `wrangler dev`/D1 binding/KV
// binding all wire up correctly before any real routes exist. Auth
// verification (src/auth.js) and the first Durable Object (PresenceHub)
// land in Phase 1.

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      let dbOk = true
      try {
        await env.DB.prepare('SELECT 1').first()
      } catch {
        dbOk = false
      }
      return Response.json({ ok: true, db: dbOk, ts: Date.now() })
    }

    return new Response('Not found', { status: 404 })
  },
}
