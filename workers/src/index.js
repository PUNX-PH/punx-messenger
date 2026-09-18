// Punx Messenger — Klipy GIF proxy + bot token issuer.
//
// This stays intentionally small. There are exactly two reasons a server
// exists at all, and neither of them holds app data:
//   1. Keeping the Klipy API key off the browser (it's a URL path segment,
//      not a header — see src/lib/gifs.js on the client).
//   2. Minting Firebase custom tokens for bots, which needs a service-account
//      key that obviously can't ship to a client (see routes/bots.js and
//      docs/BOTS.md).
//   3. Minting short-lived TURN credentials, for the same reason: the key that
//      issues them must not reach a browser, and what it issues expires (see
//      routes/turn.js).
//   4. Running the DTR reminder on a cron. This one is not about hiding a key:
//      it needs to run when nobody has the app open, and a browser cannot do
//      that (see routes/dtr.js).
// Firebase/Firestore remains the real backend for everything else.

import { AuthError } from './auth.js'
import * as bots from './routes/bots.js'
import { runDtrReminder } from './routes/dtr.js'
import * as gifs from './routes/gifs.js'
import * as turn from './routes/turn.js'

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!allowed.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
      // Short-lived TURN credentials, one per signed-in caller. See
      // routes/turn.js for why this cannot be a build-time constant.
      if (url.pathname === '/turn/credentials' && request.method === 'GET') {
        return withCors(await turn.issueIceServers(request, env), cors)
      }
      // Bots call this server-to-server, so CORS is irrelevant to them — but
      // it's echoed anyway so the endpoint stays testable from a browser.
      if (url.pathname === '/bot/token' && request.method === 'POST') {
        return withCors(await bots.issueBotToken(request, env), cors)
      }

      // Manual trigger, for testing the reminder without waiting a fortnight
      // for the cron. Gated on a shared secret rather than a user's ID token:
      // this DMs the entire workspace, so it should not be reachable by
      // anybody who merely happens to be signed in.
      //
      // ?dry=1 renders the message and counts recipients without writing, and
      // is the sane way to check a cutoff's dates before the real send.
      if (url.pathname === '/dtr/remind' && request.method === 'POST') {
        if (!env.DTR_TRIGGER_SECRET) {
          throw new AuthError('DTR_TRIGGER_SECRET is unset, so the manual trigger is disabled', 503)
        }
        const provided = (request.headers.get('Authorization') || '').replace(/^Bearer /, '')
        if (provided !== env.DTR_TRIGGER_SECRET) throw new AuthError('Forbidden', 403)
        const result = await runDtrReminder(env, {
          force: url.searchParams.get('force') === '1',
          dryRun: url.searchParams.get('dry') === '1',
        })
        return withCors(Response.json(result), cors)
      }
    } catch (err) {
      if (err instanceof AuthError) return withCors(Response.json({ error: err.message }, { status: err.status }), cors)
      console.error('[worker] unhandled error:', err)
      return withCors(Response.json({ error: 'Internal error' }, { status: 500 }), cors)
    }

    return withCors(new Response('Not found', { status: 404 }), cors)
  },

  // Fires daily; runDtrReminder decides whether today is actually the day.
  // A daily cron with the decision in code beats encoding "the day before a
  // cutoff ends" in cron syntax, which cannot express it — cutoffs are set by
  // hand and do not land on fixed dates.
  //
  // Throwing here is deliberate. A scheduled invocation that swallows its
  // error reports success, and nobody finds out the reminder stopped going
  // out until someone asks why they were never told to submit.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runDtrReminder(env)
      console.log('[dtr] reminder run:', JSON.stringify(result))
    })())
  },
}
