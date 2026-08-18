# Punx Messenger — bot access points

The contract an external bot codes against. Everything here is stable; treat
it as the API surface.

Design in one line: **a bot is a real user with a scoped identity.** It uses
the ordinary Firebase SDK — including realtime listeners — and
`firestore.rules` limits it exactly as far as its registry doc allows. There is
no REST wrapper to go through and no polling.

Why that shape: Firestore is the backend and there's no always-on server, so
whoever holds the Firestore listener is what makes a bot realtime. That's the
bot itself. A push/webhook model would need Cloud Functions, which is infra
this project doesn't have.

---

## 1. Getting an identity

An admin registers the bot in **Admin panel → Bots** and hands over an API key
once. Only its SHA-256 is stored, so a lost key can't be recovered — rotate for
a new one.

Trade the key for a Firebase credential:

```
POST https://punx-messenger-gifs.rey-433.workers.dev/bot/token
Content-Type: application/json

{ "apiKey": "punxbot_<botUid>_<secret>" }
```

```json
{ "token": "<firebase custom token>", "uid": "<botUid>", "expiresIn": 3600 }
```

Then, in the bot:

```js
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'

const auth = getAuth(initializeApp(firebaseConfig))  // same config as the web app
await signInWithCustomToken(auth, token)
```

From here the bot is `botUid` and every Firestore call works as it does in the
web app.

**Refresh:** the custom token is single-use and valid for one hour, but the
Firebase SDK refreshes the resulting *session* on its own indefinitely. Only
re-request if `signInWithCustomToken` itself fails, or the process restarts.

Errors: `401` invalid key (deliberately indistinguishable from unknown bot, so
the endpoint can't be used to enumerate bot ids) · `403` bot disabled · `503`
the Worker has no service-account key configured.

## 2. Permissions

Two independent things decide what a bot can do:

| | |
|---|---|
| **Which channels it can see** | Whichever groups an admin has added it to, exactly like a person. Not a scope. |
| **What it can do there** | Its scopes. Only ever grant writes. |

| Scope | Grants |
|---|---|
| `messages:write` | Send / edit / delete its own messages |
| `reactions:write` | Reactions, and pin/unpin (normally admin-only) |
| `dm:write` | Create DM conversations and post in them |
| `voice:join` | Join a voice channel's roster and signal — required for music |
| `channels:manage` | Create / rename / delete channels and categories |
| `members:manage` | Add / remove group members. Never admins or ownership. |

Both `enabled` and `scopes` are re-read from `bots/{botUid}` on **every**
request rather than trusted from the token, so revoking either takes effect
within seconds — not at the next token refresh. A disabled bot fails
`isBot()` and loses all access, including read.

## 3. Data model

Paths and shapes the bot reads and writes. These mirror what the web client
does; `src/lib/db.js` and `src/lib/groups.js` are the reference implementation.

```
users/{uid}                                  bots included, with type: 'bot'
groups/{groupId}                             memberUids, adminUids, name
groups/{groupId}/categories/{categoryId}
groups/{groupId}/channels/{channelId}        { name, type: 'text'|'voice', categoryId, order }
groups/{groupId}/channels/{channelId}/messages/{msgId}
dms/{convoId}                                convoId = [uidA,uidB].sort().join('__')
dms/{convoId}/messages/{msgId}
bots/{botUid}                                own config, incl. published commands
```

### Message shape

```js
{
  text: string,
  author: { uid, name, photoURL },   // uid MUST equal the bot's own uid
  createdAt: serverTimestamp(),
  imageURL: string | null,           // a URL, or a base64 data URL
  imageMeta: { width, height, size } | null,
  mentionedUids: string[],
  reactions: { [emojiKey]: string[] },
  pinned: boolean,
  editedAt: null,
}
```

**Never write `undefined` to Firestore** — it throws, where `null` is fine.
This has bitten this codebase before (see the GIF picker's `?? null`
fallbacks). Any field that might be absent must be an explicit `null`.

After posting, bump the parent for unread state — group members are allowed to
write only these two keys on a channel:

```js
await updateDoc(doc(db, 'groups', groupId, 'channels', channelId), {
  lastMessageAt: serverTimestamp(),
})
```

## 4. Voice — what a music bot has to do

Voice channels are **mesh WebRTC**: every participant holds a direct
`RTCPeerConnection` with every other one. There is no media server, and
signaling runs entirely through Firestore. A bot joining is just another
participant — nothing about the protocol is bot-specific.

`src/lib/voiceChannel.js` and `src/lib/useVoiceChannel.jsx` are the working
reference for all of the below.

**Join** — write your roster doc, id = your uid:

```
groups/{groupId}/channels/{channelId}/voiceParticipants/{botUid}
  { uid, joinedAt, lastHeartbeat, muted, deafened, cameraOn, screenSharing }
```

**Heartbeat every ~15s** by updating `lastHeartbeat`. Anyone in the group may
delete a roster doc whose heartbeat is over **2 minutes** stale, and when that
happens every other client tears down its connection to you — so a bot that
stops heartbeating gets silently dropped mid-song.

**Pair up.** Watch the roster; for each other participant, the offerer is
deterministic, so there is no glare and no negotiation about who calls whom:

```js
const pairKey    = [a, b].sort().join('__')
const offererUid = [a, b].sort()[0]   // lexicographically smaller uid offers
```

```
groups/{groupId}/channels/{channelId}/voiceSignals/{pairKey}
  { uids: [a,b].sort(), offererUid, offer, answer }
  candidates/{autoId}  { from, candidate, createdAt }
```

If you're the offerer, create the doc with your `offer` and wait for `answer`.
If not, wait for the doc, then write `answer` — only the non-offerer may, and
only once. ICE trickles through the `candidates` subcollection both ways;
buffer any that arrive before you've set a remote description.

**Sending audio.** Browsers add an empty video transceiver at join time and one
audio track. A music bot only needs to send audio, and never needs to receive,
but must still answer/offer correctly for every peer.

Practical note: this needs a real WebRTC stack, not the Firebase SDK —
[`werift`](https://github.com/shinyoshiaki/werift-webrtc) if you want it in
pure Node, or headless Chrome driving the actual web app if you'd rather not
implement mesh signaling twice.

**Mesh cost is real:** N participants means N−1 outbound audio streams from the
bot. Fine for a team-sized channel, not for a hundred people.

**Leave** by deleting your roster doc. Best-effort delete your `voiceSignals`
docs too.

## 5. Not built yet

- **Slash commands** — `bots/{botUid}.commands` exists and is read/writable,
  but nothing consumes it yet. The composer autocomplete and the
  app→bot interaction documents are the next phase. Until then, a bot has to
  match message text itself.
- **Bot avatars** — `photoURL` is on both the registry and mirror `/users` doc
  and renders wherever avatars render, but the admin panel has no uploader yet.
  Set it directly if you need one.
- **Rate limiting** on `/bot/token`. It's one Firestore read per call and the
  key is unguessable, but there's no throttle.

## 6. Operational notes

- The Worker needs `FIREBASE_SERVICE_ACCOUNT` — a whole service-account JSON —
  as a **runtime secret** (Cloudflare's *Variables and secrets*, type Secret;
  **not** the build-time variables section, which is a different scope that has
  caused confusion on this project before). Without it `/bot/token` returns 503
  and nothing else is affected.
- That key can bypass `firestore.rules` entirely. It exists solely so the
  Worker can sign custom tokens and read one key hash; keep it out of the repo
  and out of the client bundle.
- Editing a Cloudflare variable creates a new Worker **version** that is not
  automatically live — check Deployments → Version History and *Promote
  version* if the newest isn't marked active.
- Bot activity is indistinguishable from user activity in Firestore usage
  metrics. A chatty listener costs reads like any other client.
