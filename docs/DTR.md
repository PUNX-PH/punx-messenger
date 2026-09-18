# DTR reminder

DMs the workspace the day before a DTR cutoff closes, telling everyone to
submit and by when. Replaces a reminder that was sent by hand over Gmail.

| | |
| --- | --- |
| Job | `workers/src/routes/dtr.js` |
| Wiring | `workers/src/index.js` (`scheduled`, and `POST /dtr/remind`) |
| Reads | `punx-dtr` → `cutoffs` |
| Writes | `punx-msg` → `dms/*`, and `punx-dtr` → `cutoffs/{id}` (the sent marker) |

## Two Firebase projects

The DTR app is **`punx-dtr`**; the messenger is **`punx-msg`**. Separate
Firestore, separate auth, so the same person has a different uid in each and no
client can read across them. The Worker holds a service account for each —
`FIREBASE_SERVICE_ACCOUNT` and `DTR_SERVICE_ACCOUNT`. One cannot be used for
both: the credential is scoped to a project.

They also cannot share an access-token cache entry. `googleAuth.js` keys the
cache by `client_email` for that reason; a fixed key would hand whichever token
was cached first to both and produce 403s that point nowhere near a cache.

## Why it is a broadcast

The Gmail version opened "Hi Team!" and went to everybody, and copying that
avoids the single fragile part of joining these systems. **Email is the only
key** between the two directories, so a targeted send would silently stop
reminding anyone whose two accounts differ — a failure nobody would notice
until payroll.

Targeting is cheap to add later: submissions are keyed `{userId}_{cutoffId}`,
so "has this person submitted" is one document get. It reintroduces the
matching problem, which is why it is not the first version.

## Two reminders

| Kind | Sends | Message |
| --- | --- | --- |
| `cutoff` (heads-up) | `endDate − 1 day` | What the Gmail version said, near verbatim |
| `deadline` (last call) | `submitBy − 1 day` | Short: time remaining, and "ignore this if you already submitted" |

They are separate dates because **the deadline is not the end of the period**.
A period closing Thursday has been due 10:00 Friday, so the two land on the
Wednesday and the Thursday.

The last call is deliberately shaped differently. Two DMs a fortnight that open
identically train people to stop reading the second one — which is the one that
matters — so it leads with the time left and drops the reimbursement
boilerplate. Being a broadcast it cannot know who has already submitted, so it
says so plainly instead of pretending.

**`deadline` wins when both land on the same day**, which happens when a
cutoff's deadline is the day it closes rather than the day after. One DM beats
two saying much the same thing, and the last call is the more useful.

**Each kind has its own sent-marker** (`reminderSentFor`,
`deadlineReminderSentFor`). A single shared marker would let the heads-up
suppress the last call entirely.

Known sharp edge: `submitBy − 1` can land on a weekend. A Monday 10:00 deadline
sends its last call on the Sunday. Nothing shifts it to the previous working
day — say so if that is wanted.

## Timing

The cron is **daily**, and the job decides which reminder today is, if any.
Cron syntax cannot express "the day before a cutoff ends" — cutoffs are set by
hand and do not land on fixed dates.

**Cloudflare crons are always UTC.** `0 1 * * *` is 09:00 Manila. A schedule
written as `0 9` fires at 5pm Manila, a day late to be useful. The date
comparison is done on Manila calendar dates for the same reason.

## The deadline is stored, not derived

`cutoffs.submitBy` is set in the DTR admin form, defaulting to 10:00 AM the day
after the period closes. It could have been derived from `endDate` and that is
right until the first holiday moves it — but the deadline goes to the whole
team at once, reads as authoritative, and nothing contradicts it. Everyone
submits against a time that was never real.

Cutoffs created before the field existed have no `submitBy`, and only those
fall back to the derived value. Nothing is backfilled.

## The bot

Posts as a registered bot with the **`dm:write`** scope, which
`firestore.rules` checks via `botCan()`. Register it in the admin panel and put
its uid in `DTR_BOT_UID`.

The Worker holds a service account, so it *could* write the DMs directly and
bypass rules entirely — and deliberately does not. The bot platform chose
scoped custom-token identities over service-account bots (see `BOTS.md`), so
the job mints a custom token, exchanges it at identitytoolkit for an **ID
token**, and writes with that. Firestore will not accept a custom token
directly; the exchange needs `FIREBASE_WEB_API_KEY`, which is the public key
already in the client bundle, not a secret.

The DM shape mirrors `ensureDmConvo`/`sendMessage` in `src/lib/db.js` — convo
id is the two uids sorted and joined with `__`, and the parent doc carries
`members`, `memberInfo` and the `lastMessage*` fields the sidebar reads. A DM
written in a different shape exists in Firestore and is invisible in the app.

Writes use `updateMask`, because a REST `PATCH` without one **replaces** the
document: bumping `lastMessageAt` would wipe `members` and lock both people out
of their own conversation.

## Not sending twice

The cutoff is marked `reminderSentFor` after a successful run, and the job
skips a cutoff already marked. The cron runs daily and a Worker invocation can
be retried, so without it a redeploy re-DMs everybody.

Marked **after** sending, not before. Marking first loses the entire reminder
to one early failure; marking last means a crash mid-run can re-DM the people
who already got it. The second is the better failure.

A single recipient failing is collected, not thrown — one bad user document
must not cost everyone else their reminder.

## Setup

```bash
wrangler secret put DTR_SERVICE_ACCOUNT    # punx-dtr service account JSON
wrangler secret put DTR_TRIGGER_SECRET     # gates POST /dtr/remind
```

Then in `wrangler.toml`, fill `DTR_BOT_UID` and `FIREBASE_WEB_API_KEY`.

Any of them missing is a 503 with the variable named — the reminder is simply
not configured, and nothing else on the Worker is affected.

## Testing it

Do not wait a fortnight for the cron:

```bash
# render the message and count recipients, writing nothing
curl -X POST -H "Authorization: Bearer $DTR_TRIGGER_SECRET" \
  "https://<worker>/dtr/remind?dry=1&force=1"

# actually send, ignoring both the date check and the sent marker
curl -X POST -H "Authorization: Bearer $DTR_TRIGGER_SECRET" \
  "https://<worker>/dtr/remind?force=1"
```

`force=1` skips the date check and the already-sent guard. `dry=1` does
everything except write, and returns **both** messages with the day each one
sends — neither is visible on the day the other fires, so a preview that showed
only today's would hide half of what goes out.

`kind=cutoff` or `kind=deadline` forces one specific message; omitted, the date
decides. `only=<email-or-uid>` restricts a REAL send to one person, which is how
to see the message exactly as everyone else would. A test send does **not** mark
the cutoff as reminded, or testing would cancel the real send.

The trigger is gated on a shared secret rather than a signed-in user's token on
purpose: it DMs the entire workspace, and should not be reachable by anyone who
merely happens to be logged in.
