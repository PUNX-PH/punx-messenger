# New accounts join the team group

A new `@punx.ai` account is added to the workspace's main group (**PUNX TEAM**) the first time it signs in, so a new person opens the app and finds `general` and the rest, instead of an empty sidebar waiting for someone to invite them.

## How it works

A person cannot add themselves to a group: the rules let only an admin, an invite, or a member-managing bot change a group's `memberUids` (`firestore.rules`, `groups` update). The Worker holds the project's service account, so it does that one write, after checking who is asking.

1. At sign-in, right after the profile is created (or read), the app asks the Worker: `POST /onboarding/join-default-group`, with the person's own ID token and **no body** (web: `src/lib/onboarding.js`, `onboardingApi.js`, hooked in `src/lib/auth.jsx`; phone: `android_app/lib/utils/default_group.dart`, `services/default_group_service.dart`, hooked in `services/auth_service.dart`). It does not wait for the answer and a failure never affects signing in.
2. The Worker (`workers/src/routes/onboarding.js`) verifies the token, then checks, **again** (the app is not trusted):
   - the email on the token is exactly `name@punx.ai` (the `ALLOWED_EMAIL_DOMAIN`); an externally allowed address such as the gmail one in `ALLOWED_EXTRA_EMAILS` is signed in as staff but is **not** added;
   - the profile exists, is not removed (`deactivated`), and is staff (`employee`, `admin`, `super_admin`, `developer`), not a `guest`;
   - the profile has no `defaultGroupJoinedAt` (see below);
   - the profile was created in the **last 7 days**.
3. It finds the group (below) and, in **one atomic commit**, appends the caller's uid to the group's `memberUids` (an array union, so two people joining at once cannot overwrite each other) and stamps `defaultGroupJoinedAt` on the caller's profile.

Public channels follow group membership (`channelVisible` in `firestore.rules`), so being in `memberUids` is all a new person needs to see `general`, `feebacks`, `patch-notes` and the voice channel. Private channels stay private.

## Why these limits

- **Only the last 7 days.** People who were here before this existed are not touched. The week is what lets a first attempt that failed (offline, Worker down) be retried at the next sign-in.
- **`defaultGroupJoinedAt`.** Once stamped it stays. Someone who later leaves PUNX TEAM is not put back at the next sign-in.
- **Only the caller.** The uid comes from the verified token; the request carries nothing else. Nobody can add anybody else with this route.
- **Never guests.** A guest is invited into single channels and sees nothing else; adding them to the team group would show them everything in it.

## Which group

`DEFAULT_GROUP_NAME = "PUNX TEAM"` in `workers/wrangler.toml`. The Worker reads the groups and takes the one whose name matches **ignoring case and surrounding spaces**. It joins **nothing** (and logs why to the Worker's logs) if:

- two or more groups have that name, or none does, or
- the one it finds is not owned by a `developer`, `super_admin` or `admin`.

The second is on purpose: an ordinary member could otherwise make a group with that name and have every new account land in it.

To pin the group instead of finding it by name, add `DEFAULT_GROUP_ID = "<the group's id>"` to `wrangler.toml` (the id is in the address bar when the group is open in the web app). A configured id wins over the name and is trusted as configured.

## When nothing happens

The route answers `200` with `{ "joined": false, "reason": ... }` for every "no", so a refusal is never an error:

| `reason` | Meaning |
| --- | --- |
| `not-company-email` | the address on the token is not `@punx.ai` |
| `no-profile` | no profile yet |
| `removed` | the account was removed |
| `not-staff` | a guest, or an unknown role |
| `already` | already stamped (joined, or left since) |
| `not-new` | the profile is older than 7 days, or has no creation date |
| `no-default-group` | no single trusted group matched (see above) |

A real failure (the commit was refused, Google was unreachable) answers `502` and **does not stamp the profile**, so the next sign-in tries again.

## The people who were already here

The sign-in route above only looks at the last week, so it does not touch people who signed up before it existed. They are added once, by a **developer or super admin**, from the **Team group** card at the foot of the admin page:

1. **See who would be added.** Calls `POST /onboarding/add-existing-members?dry=1` (`workers/src/routes/onboarding.js`, `src/components/TeamGroupAdmin.jsx`). Nothing is written. It shows how many would be added, how many are already in, and the first names.
2. **Add N people.** Only after that preview, and only if there is someone to add. Calls the same route without `?dry=1`.

Who qualifies is the same as for a new account, with one addition: a company address (`@punx.ai`), staff and not a guest, not removed, not already stamped, and **never a bot**. Outsiders invited into single channels, bots, removed accounts and the externally allowed addresses are left out, and the preview counts each of those so nothing is silent.

How it writes: first one array-union commit per 400 people onto the group's `memberUids` (people already in are left alone), then it stamps every qualifying profile with `defaultGroupJoinedAt` in commits of 200, so someone who later leaves the group is not put back if the job is run again. Each commit is atomic; the whole job is not, so if it stops part-way, run it again: what was done stays done and the rest is finished. It is safe to run twice. It refuses (413) if the workspace has 2000 accounts or more, rather than do part of the list, and answers 409 if no single trusted default group is found.

The route reads the caller's role fresh from their profile on every call (never from the token), requires a company address, and only `developer` and `super_admin` get through; an admin does not, because this changes who is in a group workspace-wide. It logs who ran it and how many were added.

One thing to know: this adds **everyone** who qualifies, including anyone who had deliberately left PUNX TEAM before this existed (there is no record of that, since the stamp did not exist). They are added once, and not again.

## Not done by this

- **Other groups.** One default group only.
- **Rules.** Nothing in `firestore.rules` changed, and nothing needs deploying beyond the Worker (which deploys on merge to `main`).

## Checking it works

Sign in as a brand-new `@punx.ai` account (a test account is fine): its profile gains `defaultGroupJoinedAt` and PUNX TEAM appears in its sidebar within a moment. If the group does not appear, look at the Worker's logs for `[onboarding]` lines (they say which of the checks above refused) or `[firestore] commit failed` (the Worker's service account may not be allowed to write to Firestore; the first real use is the first time it does).
