# Roles and access

Who can see and do what. `firestore.rules` is the authority — everything here
describes it, and the client mirrors it in `src/lib/auth.jsx` so the UI doesn't
offer buttons the backend will reject. If the two ever disagree, the rules win
and the client has a bug.

## The hierarchy

Highest first.

| Role | What it adds |
|---|---|
| `developer` | Everything `super_admin` has, **plus** the one thing it doesn't: groups a developer *owns* are invisible and untouchable to super admins. Only a developer can grant or revoke this role. |
| `super_admin` | Manages roles and the workspace. Read-only oversight of every group without joining — except developer-owned ones. |
| `admin` | Group settings, pinning and deleting anywhere, channel management, bots. Only sees groups they're in. |
| `employee` | Read and post in their own groups, DMs, private notes. The default. |
| `guest` | Invited to specific **channels**, not groups. Sees nothing else. Cannot create groups. |

Two helpers carve this up, and the split matters when reading the rules:

- `isTopTier()` — "runs the workspace itself": role administration, the bot
  registry, oversight. `developer` + `super_admin`.
- `isWorkspaceAdmin()` — "manages groups and content". `admin` + the top tier.

Roles live on `users/{uid}.role`. A missing role reads as `employee`. Nobody can
change their own role; `super_admin` and `developer` change others'.

## Super-admin oversight

A super admin (or developer) can read every group in the workspace without being
a member — `canOverseeAll()` in the rules, `canOversee()` on the client. The
point is oversight without disruption, so two things are true at once:

- **They're invisible.** They aren't in `memberUids`, so member lists, voice
  rosters and mention pickers never show them.
- **They're read-only.** That invisibility is only real if they can't write — a
  message, a reaction, a typing indicator or a voice join would each announce
  them. So the composer, reactions, pinning, edit/delete, drag-to-reorder, group
  settings and voice join are all switched off while overseeing.

In the UI these appear in the server rail below their own divider, greyed with an
eye badge. Right-click one for **Join group**, which is how you start being able
to write in it.

`listenAllGroups()` runs an unfiltered collection query, which is only legal
because the oversight clause holds for every document it returns. Anyone without
the role gets the whole snapshot denied, so callers must check the role first.

## The developer boundary

A group whose `ownerUid` belongs to a developer is off-limits to anyone who
isn't a member. There's no developer escape hatch either — one developer cannot
read another's group.

Three things close together, and all three are needed. Any one left open makes
the other two decorative:

1. **Reads** — `overseeGroup()` excludes developer-owned groups, so channels,
   messages, categories and voice rosters are denied.
2. **Writes** — `adminOverGroup()` replaces plain workspace-admin power inside a
   group. Without it a super admin would just add themselves to `memberUids` and
   read the group legitimately.
3. **Role grants** — only a developer (or the bootstrap email) may grant,
   revoke or delete a developer. Without it they'd demote the developer instead.

**Bootstrap:** the first developer has to come from somewhere, so the bootstrap
email in `isBootstrapSuperAdmin()` can also grant the role. Keep it in step with
`VITE_SUPER_ADMIN_EMAILS`.

**Known trade-offs**, both deliberate:

- Protection follows **ownership**. Transferring such a group to a
  non-developer owner removes it.
- The group **document** stays readable under oversight, so its name and member
  list are visible via the API; no channel, message or voice participant is. An
  unfiltered list query is denied whole if any single document is denied, and
  owner-role exemption can't be expressed as a query filter — so denying the doc
  would leave super admins with no group list at all. The rail filters these
  groups out client-side, so they aren't displayed.

## Per-channel access

Two independent mechanisms on `groups/{id}/channels/{id}`:

| Field | Meaning |
|---|---|
| `private: true` | Hidden from group members not on `allowUids`. Group and workspace admins still see it, same as Discord. |
| `allowUids: string[]` | The list. For a **guest** this is the only thing that counts. |

So:

- **Employee and above** — sees every channel except private ones they aren't
  listed on.
- **Guest** — sees *only* channels naming them, private or not. No admin
  override applies, because a guest is never an admin.

That independence is the useful part: you can invite a guest to an existing
**public** channel without making it private to everyone else.

A channel with no `private`/`allowUids` fields is public. Channels created
before this feature have neither, and every field read in the rules is
`in`-guarded so an absent key reads as "public" rather than erroring — an error
in a rule denies, which would have hidden every pre-existing channel.

Reads and **writes** are both gated: message create/edit/delete, reactions, the
`lastMessageAt`/`typing` bump, and joining voice all check channel access.

### Inviting a guest

Two routes. Prefer the link.

**By invite link** — works for people with no account at all. Group settings
→ **Invites** → tick the channels → **Create & copy link**, and send it. They
open it, sign in with any Google account, and land in those channels as a guest.
See *Invite links* below.

**By hand** — for someone who already has an account:

1. **Admin panel** → set their role to **Guest**.
2. Sidebar header → **Members** → add them to the group. Required: the rules
   need group membership *and* the channel invite. On its own this shows them
   nothing, and until they're a member they won't appear in step 3.
3. Right-click the channel → **Manage access** → tick them → **Save access**.
   Repeat per channel. Voice channels work the same way.

If they see the group but no channels, step 3 is missing. If they can't see the
group either, step 2 is.

### The guest channel query

Guests cannot run the unfiltered channel query — the rules deny every channel
that doesn't name them, and one denied document fails the whole query. So
`listenChannels(groupId, cb, onError, guestUid)` takes a fourth argument that
switches to `where('allowUids', 'array-contains', uid)`.

**Every call site needs it.** Miss it anywhere and that guest's snapshot is
denied and they see nothing: `ChannelSidebar`, `views/Channel.jsx`,
`views/GroupHome.jsx`, `ServerRail`.

Ordinary members keep the unfiltered query, which is why private channel
documents stay readable for them (see the trade-off above — contents are still
denied). Closing that would mean backfilling `private` onto every existing
channel first.

## Who can sign in

Google is the **only** human sign-in path, and that is load-bearing rather than
incidental: it means the address on the token was verified by Google. Never
widen it to a provider where an account picks its own unverified address —
`createUserWithEmailAndPassword` does exactly that, which would make the
internal-domain check self-assertable and let anyone in as an employee.

Admission is therefore **either** an `@punx.ai` address **or** simply having a
`users/{uid}` document, which is the record of having been let in. An invited
outsider's Google address grants them nothing; their only route to a document is
redeeming a live invite as a `guest`. Deleting someone's `users` doc revokes
their access entirely.

## Invite links

`invites/{token}` — the document id **is** the secret, handed out as
`/invite/<token>`. Reusable until it expires or an admin revokes it.

```
invites/{token}   { groupId, groupName, channelIds[], channelNames[],
                    createdBy, createdAt, expiresAt, revoked }
invites/{token}/redemptions/{uid}   audit trail, written by the joiner
```

`groupName`/`channelNames` are denormalised because whoever opens the link has
no read access to the group yet — the accept screen has to describe the
invitation from this one document.

Admins create and revoke links in **group settings → Invites**. `revoked` is the
only field anyone may change: an existing link must never be repointed at
another group or a wider channel set, or everyone already holding the URL would
silently gain that access.

Reading an invite requires being authenticated (any Google account). That's
deliberate — a link that leaks shouldn't tell a stranger or a crawler that there
is a channel called `#payroll`.

### Redemption

Done **by the joiner**, in this order, because each step unlocks the next:

1. `users/{uid}` — created as `guest` for a newcomer, or just stamped with
   `invitedVia` if they already have an account. **An existing member keeps
   their role**; a link must never be able to demote an admin.
2. the redemption marker.
3. add themselves to the group's `memberUids`.
4. add themselves to each invited channel's `allowUids`.

Rules can't take arguments from the client, so the token is recorded on the
joiner's own `users` doc as `invitedVia` and every later self-add is validated
against it.

`addsOnlyMeTo(field)` enforces steps 3 and 4. It requires that the caller is
**not already in the list**, that the list grew by exactly one, and that they're
in the result. All three matter: without the "not already present" clause,
someone who had joined could add one *other* person and pass. Two rules tests
cover exactly that.

## Testing

The rules have an emulator test suite at `tests/rules.test.mjs` — 104 cases
covering the hierarchy, the developer boundary, guests, private channels, invite
links, the auth gate, bots, and regressions for behaviour that had to stay
unchanged. It needs Java on `PATH` and `@firebase/rules-unit-testing`, which is
kept out of `package.json` on purpose (it conflicts with the pinned firebase
version and would break `npm ci`):

```bash
npm i --no-save --legacy-peer-deps @firebase/rules-unit-testing
npx firebase emulators:exec --only firestore --project punx-rules-test "node tests/rules.test.mjs"
```

The whole app can also be run against the emulators with no password sign-in —
set `VITE_USE_EMULATORS=1` with a `demo-` project id (`src/lib/firebase.js`
refuses anything else, so an emulator run can never reach live data).

## Adding a role

1. `ROLES` in `src/lib/users.jsx`, plus a `roleLabel` case and a `RoleBadge`
   entry.
2. A predicate in `src/lib/auth.jsx`.
3. A matching helper in `firestore.rules`.

Steps 1 and 3 are independent and will silently diverge — the client will offer
something the backend rejects. Add a test.

## Not built

- **Hiding private channel names** from ordinary members. Needs the backfill
  described above.
- **Invite usage caps.** Links are reusable with an expiry and a revoke button;
  there's no max-uses counter. The `redemptions` subcollection records who used
  a link, so adding one later is a counting change, not a redesign.
- **Guests without a Google account.** Currently they cannot get in at all —
  Google is the only human sign-in path, so the invite screen leaves them stuck.
  Two ways to fix it, in preference order:

  1. **Email-link (passwordless) sign-in.** Firebase emails a one-time link;
     clicking it proves the person controls that inbox, which is exactly what
     email/password does *not* prove. Caveat to verify first: Firebase reports
     email-link sign-in as `sign_in_provider: 'password'`, the same as
     email/password, so the rules cannot tell them apart by provider — the
     distinguisher is `email_verified` (true for a link, false for a fresh
     password signup). Confirm the real token claims against the Auth emulator
     before relying on that. The internal-domain path must stay Google-only
     regardless; non-Google accounts would be admitted only as invited guests,
     which the "you have a users doc" model already supports.
  2. **A second OAuth provider** (Microsoft, Apple). Those verify addresses the
     same way Google does, so it needs no new gate logic — just another provider
     in the same clause. Likely to cover more business guests than email links.

- **Email/password signup.** Deliberately never built. See the warning under
  *Who can sign in*: an account that picks its own unverified address makes the
  internal-domain check self-assertable.

- **Invite usage caps.** Covered above — the `redemptions` subcollection already
  records who used each link.
