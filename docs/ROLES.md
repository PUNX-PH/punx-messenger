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

**Every channel document must carry `private`.** One that doesn't is denied to
everyone below admin — not treated as public. That is the price of hiding
private channel names at all; see *The channel queries* below for why. Both
clients write the field on every channel they create, and
`scripts/backfill-channel-privacy.mjs` stamped the ones that predate it. Re-run
that script after any bulk import, and read its VERIFY line.

A channel's **name** is as protected as its contents: the document, its
messages, its voice roster and every write are gated together. Reads and
**writes** both: message create/edit/delete, reactions, the
`lastMessageAt`/`typing` bump, and joining voice all check channel access.

### Inviting a guest

Two routes. Prefer the link.

**By invite link** — works for people with no account at all. Two entry
points, same link:

- Group settings → **Invites** → tick the channels → **Create & copy link**,
  for a link granting several channels at once.
- Right-click the channel → **Manage access** → **Create & copy link**, for one
  scoped to just that channel. Handy because the list in that modal only
  reaches people who are already group members, and an outsider isn't one yet.
  The link is written immediately, independently of **Save access**.

They open it, sign in with any Google account, and land in those channels as a
guest. Either route can grant a **private** channel; redemption adds them to
its `allowUids`. See *Invite links* below.

**By hand** — for someone who already has an account:

1. **Admin panel** → set their role to **Guest**.
2. Sidebar header → **Members** → add them to the group. Required: the rules
   need group membership *and* the channel invite. On its own this shows them
   nothing, and until they're a member they won't appear in step 3.
3. Right-click the channel → **Manage access** → tick them → **Save access**.
   Repeat per channel. Voice channels work the same way.

If they see the group but no channels, step 3 is missing. If they can't see the
group either, step 2 is.

### The channel queries

Nobody queries a group's `channels` collection unfiltered. Understanding why
takes one non-obvious fact about Firestore:

> **A query is not checked against the documents it returns.** The rule is
> evaluated once against the *query*, with a `resource` that knows only what
> the query's own filters prove. `where('private','==',false)` makes
> `ch.private` readable as `false`; an unfiltered query leaves it unknown.
> Reading an unknown — or genuinely absent — field is an **error**, and an
> error denies.

That error is the *entire* lock. There is no per-document filtering to fall
back on: a query that gets through hands over every document it matched. This
was measured on the emulator, not assumed — while `private` was read with an
`in` guard, an ordinary member's unfiltered list returned the private channel
that `getDoc()` had denied them a line earlier.

So `firestore.rules` reads `ch.private` **unguarded** and `allowUids`
**guarded**, and both of those are load-bearing in opposite directions. Swap
either and the boundary silently opens, or every sidebar comes up empty.

Each caller runs the legs it can prove, and the union is what it may read:

| Who | Legs |
|---|---|
| Guest | `allowUids array-contains me` |
| Member | `private == false`, and `allowUids array-contains me` |
| Admin, oversight | those two, plus `private == true` |

`listenChannels(groupId, cb, onError, viewer)` takes the plan as its fourth
argument; build it with `channelViewer(profile, group)` from `lib/auth`.
**Every call site needs one** — `ChannelSidebar`, `views/Channel.jsx`,
`views/GroupHome.jsx`, `ServerRail`, `GroupInvites`. The Android app has the
same split in `GroupsRepository.listenChannels` and `channelViewerProvider`.

The private leg is a *guess* at admin rights, so it is optional: if the rules
disagree it is dropped and the rest of the list still arrives. That covers the
one case the client can't reproduce — a workspace admin inside a
developer-owned group, where the rules grant them nothing.

An admin can still list unfiltered, because `adminOverGroup()` is checked
before `ch.private`. That ordering is deliberate: whoever can re-run the
backfill can still see the channels it missed.

## Removing someone

Admin panel → the member's row → **Remove**. Developers and super admins only,
and never a developer unless you are one — removing a developer would strip the
group boundary exactly as demoting them would, so `developerRoleChangeAllowed()`
covers both.

It sets `deactivated: true` on `users/{uid}`, and `isHuman()` in the rules then
refuses that account **everything**. Two things to understand about why it works
that way:

- **Deleting the document would not remove a staff member.** Admission is
  "internal email OR has a users doc", and the create rule lets any `@punx.ai`
  Google account recreate its own doc as `employee` on the next sign-in. They
  would be back, in the DM list, the next time they signed in. (For a guest a
  delete *would* stick — the document is their only admission — but one
  mechanism beats two.)
- **Their Google account still exists.** Deleting a Firebase Auth account needs
  the Admin SDK, which this app has no access to. The workspace simply stops
  answering to it. A removed account that signs in reads its own users doc —
  specifically allowed, and the only thing it can do — and is told it was
  removed rather than shown a rules error.

What removal deliberately leaves alone: their messages, and their membership of
groups and channels. History stays attributed, memberships are inert while the
account is refused, and **Restore** gives back exactly what they had.

The cost is one document read per human request: `iAmDeactivated()` reads the
caller's own users doc, where the internal-email path used to need no read at
all. There is nowhere cheaper to put it — a fired employee's token is
indistinguishable from a current employee's. It is cached per request, so it is
one read per request rather than one per rule that asks.

Client-side, `useUsers()` hands back three shapes and picking the wrong one is a
visible bug:

| | Contains | Use it for |
|---|---|---|
| `byId` | everyone, removed included | resolving identities — message authors, voice tiles, group owners |
| `activeUsers` | everyone still here | anywhere a person is *picked*: DM list, mention picker, member panels, add-members |
| `users` | the raw list | the admin panel, the one screen that must show removed accounts to restore them |

### Retired bots

A bot switched off under **Bots** disappears from the DM list too: `setBotEnabled`
mirrors the registry's `enabled` flag onto the bot's users doc as the same
`deactivated` field, so one filter hides both a removed person and a retired
bot. The mirror is cosmetic for a bot — `enabled` on the registry doc is what
the rules actually read — and a bot left enabled stays DM-able as before.

Two consequences worth knowing:

- **Bots disabled before this existed have no mirrored flag**, so they keep
  showing in DMs until you either toggle them under Bots or hit **Remove** on
  their row in the members table.
- **Remove** works on a bot's row directly, and only hides it: the registry
  stays enabled, so the bot keeps working in channels. That is a legitimate
  state — useful, not DM-able — just not the same thing as switching it off.

## Who can sign in

There are two Google providers and the difference between them is purely
cosmetic — both end up at the same `google.com` token. `googleProvider` carries
Google's `hd` hint so staff get `@punx.ai` prefilled; `anyDomainGoogleProvider`
drops it, because `hd` renders the domain as a fixed **suffix** on the email
field, and an invite screen showing that reads as "only @punx.ai works here" —
the opposite of the truth. Use the any-domain one anywhere an outsider might
sign in: `signIn({ anyDomain: true })`.

Both set `prompt: 'select_account'`, which is what makes the invite screen's
**use a different account** link work: signing in again over a live session
replaces it, with no signed-out state in between.

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

The rules have an emulator test suite at `tests/rules.test.mjs` — 143 cases
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
