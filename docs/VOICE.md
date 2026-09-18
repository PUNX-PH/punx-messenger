# Voice channels and calls

Two features share one engine: **voice channels** (Discord-style rooms, any
number of people) and **1:1 DM calls**. Both are mesh WebRTC signalled through
Firestore — there is no media server.

| | Web | Flutter |
|---|---|---|
| Engine | `src/lib/useVoiceChannel.jsx` | `lib/providers/voice_channel_providers.dart` |
| Signalling I/O | `src/lib/voiceChannel.js` | `lib/services/voice_channel_repository.dart` |
| 1:1 calls | `src/lib/useCall.jsx` | `lib/providers/calls_providers.dart` |
| Peer factory | `src/lib/webrtc.js` | `lib/services/webrtc_service.dart` |

Rules live under `match /voiceParticipants/{uid}` and `match
/voiceSignals/{pairKey}` in `firestore.rules`.

## Mesh, and what it costs you

Every pair of participants gets its own peer connection. Ten people means 45
connections, and each person **uploads their own stream nine times**.

That is fine for small rooms and falls apart in a predictable place: a screen
share at 1.5Mbps to nine viewers is 13.5Mbps sustained upstream, which most
home connections cannot do. Rough comfort limits:

- **voice only** — fine to about 4-6
- **with camera or screen share** — 2-4

Past that you need an SFU (everyone uploads once, a server fans out), which is
what Discord does. Cloudflare sells one, and notably their TURN is free when
used with it. That is an architecture change, not a config change.

## TURN

STUN only tells each side its own public address. When neither peer can reach
the other — strict NAT, corporate firewall, a VM behind its own network — there
is nothing to fall back on and **the connection fails outright**. Silently, per
pair, working for some people and not others.

That failure mode cost a lot of time before anyone thought to check ICE, so:
both clients now surface it, and the diagnostic order below starts there.

### How it is wired

Credentials **cannot be compiled in**: the key that issues them must stay
server-side, and what it issues expires. So `punx-messenger-gifs` — the Worker
that already holds secrets and mints bot tokens — mints these too.

```
client --(Firebase ID token)--> Worker /turn/credentials --> Cloudflare --> iceServers
```

- Route: `workers/src/routes/turn.js`, same `verifyAuth` as the GIF routes
- `TURN_KEY_ID` is a plain var in `workers/wrangler.toml` (not secret)
- `TURN_KEY_API_TOKEN` is a Worker secret:
  `cd workers && npx wrangler secret put TURN_KEY_API_TOKEN`
- Clients resolve **once per join or call** and reuse it, so a room of six mints
  one credential, not six
- STUN stays in the list alongside — ICE prefers a direct path and only reaches
  for the relay when it must

**Failure is deliberately quiet.** If the Worker cannot mint, clients fall back
to STUN-only, which is where the app was before TURN existed. Losing the relay
degrades hard-to-reach pairs; throwing would break voice for everyone,
including the majority who never need it.

### Cost

Billed per GB relayed out to a client, and only for pairs that actually need a
relay. Voice is rounding error (~32kbps, ~14MB per stream-hour). **Screen share
is the entire bill** — it is capped at 720p/1.2Mbps for exactly this reason
(`SHARE_MAX_*` in `useVoiceChannel.jsx`), which roughly halves the worst case.

Cloudflare dashboard → Realtime → TURN → Analytics shows actual GB. Check it
before optimising anything.

## Diagnosing "I can't see/hear them"

**Ask these in order.** Working backwards from the symptom wastes hours — a
blank tile looks identical whether ICE failed, no bytes arrived, the decoder
choked, or the renderer was not attached.

0. **Is everyone still in the roster?** Free, and the answer to "I hear some
   people but not others" more often than anything below. If the silent person
   is missing from *your* participant list while their own screen still shows
   them connected, they were pruned for missing heartbeats and every peer
   connection to them was torn down — see the heartbeat trap below. This is
   asymmetric by nature, so check both sides.
1. **Did ICE connect?** `chrome://webrtc-internals` on the web side. A
   connection going `new => failed` with no checking phase means no media can
   flow, whatever else looks healthy. Its `getUserMedia/getDisplayMedia` tab
   also proves whether capture worked.
2. **Are bytes arriving?** `getStats()` → `inbound-rtp` with `kind == 'video'`.
   No such report at all means nothing is being sent to you.
3. **Are frames decoding?** Same report: `bytesReceived` climbing with
   `framesDecoded` stuck at 0 is a codec problem.
4. **Is the renderer attached?** Only now is this worth looking at.

**`onTrack` firing proves nothing about media.** It means a remote description
was applied. Tracks arrive, tiles appear, and the SDP negotiates fine on a
connection that never establishes.

On Flutter, `adb logcat -b crash -d` catches native aborts; `AndroidRuntime:E`
does not. A changing PID between log lines means the app is crash-looping.

## Traps that have already bitten

These are all fixed. They are listed because each one took a long time to find
and the shape recurs.

- **A full-payload `setDoc` over a narrow `update` rule** works once and is
  denied forever after. Leftover docs are the normal case, not an edge case —
  teardown only runs on a clean leave. See `createVoiceOffer`.
- **"Retry on refusal" against a rule that permits something once** is a loop by
  construction unless the memory of having tried outlives the thing being
  retried. `answeredOffers` lives beside the peer map, not inside it, for
  exactly this reason.
- **Touching a remote audio track the instant it arrives aborts the process** on
  Flutter — libwebrtc raises SIGABRT on its own signalling thread, and a native
  abort cannot be caught. A fresh track already arrives enabled at full volume,
  so the common path touches nothing.
- **Closing a peer connection mid-negotiation** aborts it the same way. Peer
  churn is not just wasteful, it is fatal.
- **An answer belonging to a previous connection** installs a DTLS fingerprint
  for a peer that no longer exists: ICE reaches `connected` and DTLS sits in
  `connecting` forever, with no error. Answers are matched to the offer that
  was actually published.
- **A swallowed not-found on the heartbeat** left a client audible to nobody
  for the rest of its session. Miss more than `STALE_MS` of heartbeats — a
  hidden tab's timers are throttled and a sleeping machine stops them, and on
  Android doze or a process kill does the same — and somebody else's sweep
  deletes your roster row. That part is correct: from outside, a silent client
  and a dead one are the same thing. But `update` on a deleted document throws
  not-found, and swallowing it meant the heartbeat wrote into a void while the
  client went on believing it was connected. Every other client had already
  dropped its peer connection on the `removed` delta, and nothing offers again,
  because peer lifecycle runs off roster deltas and from their point of view
  that person left. The heartbeat now reports eviction and rejoins.
- **Re-adding the roster row is not enough to come back.** The `added` delta
  fires for everyone *else*; from the returning client's own side those uids
  never left `all`, so no delta arrives and `offerTo` refuses any pair still in
  the peer map. Half the mesh returns and half stays silent. Recovery has to
  close every peer and re-offer the pairs it owns.

## Self-healing

A pair that stops working is repaired rather than left dead, and **liveness is
measured in inbound audio bytes, not connection state**. That is not a
preference: every silent failure mode reports something different, and one
reports something healthy.

| Failure | What the state says |
| --- | --- |
| `disconnected` that never recovers | `disconnected` |
| Offer sent, answer never arrived | `new` — ICE never starts, so never `failed` |
| The DTLS trap above | `connected` — indistinguishable from working |

`inbound-rtp.bytesReceived` separates all three from a working pair for one
`getStats()` per peer per tick. A muted peer still sends RTP silence, so mute
does not read as death.

Two rules the repair must keep:

- **Only one side re-offers.** The deterministic offerer goes first and the
  answerer waits twice as long before taking over. That second window is what
  covers one-way audio, where the offerer's own inbound is healthy and it will
  never notice anything is wrong.
- **Attempts are capped, and the count outlives the connection.** A retry whose
  memory dies with the thing being retried is an infinite loop — the same trap
  `answeredOffers` exists to avoid. The counter resets when audio flows, so a
  pair that recovers keeps its full budget for later.

On Flutter the closes are **serialized**, never fired together: closing a peer
connection mid-negotiation aborts the process, so churn there is fatal rather
than merely wasteful.

## Deliberate limits

- **No ICE restart.** A pair is never renegotiated in place. Recovery rebuilds
  it from scratch instead — see "Self-healing" below, which replaced the
  original "rejoining the channel is the recovery".
- **Android/iOS receive screen shares but cannot send one.** Sending needs
  MediaProjection (Android) / ReplayKit (iOS).
- **One voice channel at a time** — joining a second leaves the first.
- **Deafen is per remote track** on mobile, because remote audio plays through
  the audio session as soon as it arrives. On web a single `<audio>` sink owns
  playback, so it is one property.
