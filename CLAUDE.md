# punx-messenger

A Discord-style team messenger. Live at https://plexus.punxai.online/.

- **Web app** (`src/`): React 18 + Vite + Tailwind, deployed by Vercel on every merge to `main`.
- **Firestore** (`firestore.rules`, project `punx-msg`): the rules are the authority; the clients are not trusted. **Rules do not auto-deploy**: `firebase deploy --only firestore:rules --project punx-msg`.
- **Workers** (`workers/`): Cloudflare Workers (bots, GIFs, DTR, TURN credentials), deployed on merge.
- **Flutter app** (`android_app/`): Android and iOS, same Firestore. Mirrors the web UI; web is the reference.

Where to read first: `SESSION-NOTES.md` (what was done, what is unverified, what is open), then `docs/` (`ROLES.md`, `VOICE.md`, `SOUNDS.md`, `BOTS.md`, `DTR.md`, `RELEASE.md`, `IOS.md`).

## Checks (CI runs all of these: `.github/workflows/ci.yml`)

```bash
npm ci
node --test $(ls tests/*.test.mjs | grep -v '/rules\.test\.mjs$')   # web logic tests
npm run build                                                        # vite.config.js also copies the blur model to public/mediapipe
(cd workers && npm ci && npm test)                                   # worker tests
(cd android_app && flutter analyze && flutter test)                  # Flutter, pinned to 3.44.8 in CI
```

Firestore rules tests need Java and the emulator, and two libraries installed **together**, never alone (either one alone with `--no-save` removes the other and the suite dies with `ERR_MODULE_NOT_FOUND`, which looks like a rules failure):

```bash
npm i --no-save --legacy-peer-deps @firebase/rules-unit-testing firebase-admin
CI=true npx firebase emulators:exec --only firestore --project punx-rules-test "node tests/rules.test.mjs"
```

A green PR therefore means the tests passed, not just that Vercel and Cloudflare built. Still say what was *not* checked.

## How work is done here

- **Test the tests.** For new logic, break the code on purpose and confirm a test fails. Several bugs here were found only that way (including 17 rules tests that passed because Firestore ran out of its 1000-expression budget, which also denies).
- **Measure performance claims** (render counts, bytes, frame rate) instead of asserting them, and write the numbers in the PR.
- **PRs:** one concern per PR, branch from `main`, **merge commit, not squash**, never delete the base branch of a stacked PR. Put the body in a temp file (`gh pr create --body-file`) and delete it afterwards. Every body has a "Checked" and a "Not checked" section; say plainly what could not be tried (no sign-in to the real app here, no phone, no Mac).
- **Update `SESSION-NOTES.md`** when a PR changes what is shipped, known, or unverified.

## Gotchas

- **Line endings:** many files are CRLF on Windows (`firestore.rules`, `tests/rules.test.mjs`, most Dart and web files, `SESSION-NOTES.md`). A multi-line edit that ignores that fails silently. Patch with a script that normalises to LF and restores CRLF, and match new files to their neighbours.
- **`dart format` on the whole project rewrites dozens of unrelated files.** Format only what you changed.
- **Do not build Android on a machine without the release keystore** (it lives on another PC, never in git). Run `flutter analyze` / `flutter test` and list anything needing Gradle or a phone as a to-do. Release builds fail without `android/key.properties` on purpose.
- **iOS has never been compiled** (needs a Mac): `docs/IOS.md`, `node scripts/ios-setup.mjs`.
- **Built files are cached for one day** (`vercel.json`, `public/_headers`), deliberately not a year: the SPA rewrite answers a missing file with HTML and a 200.
- **Presence** is kept out of the identity of users (`src/lib/usersIdentity.js`, `usePresence`); do not put `lastSeen`/`presence` back on objects that are passed around, or every heartbeat re-renders the app.
- **PowerShell in the user's own terminal blocks `npx`;** use `npx.cmd`. In PowerShell, parse `gh ... --json` with `ConvertFrom-Json`.
- **Secrets never go in the repo or in chat:** the keystore, `key.properties`, service-account keys, the Firebase CLI login. If a task needs one, say so and stop.
