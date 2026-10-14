# Session notes — 2026-10-14

What was done, what is still waiting on you, and what was found but not fixed.

## 1. Do these next (production is in a half-deployed state)

Merging to `main` auto-deploys the web app (Vercel) and the Workers (Cloudflare). **Firestore rules do not auto-deploy.** The web client now on `main` writes the invite token to `users/{uid}/private/invite`, which the *currently live* rules refuse, so **new guests cannot redeem invites until the rules are deployed.** Everything else (DMs, channels, staff sign-in) is unaffected.

```bash
git checkout main && git pull
npx firebase login
npx firebase deploy --only firestore:rules --project punx-msg
```

Then smoke-test on the real app (only emulator tests have been run against the new rules):

1. Redeem an invite as a brand-new Google account.
2. Re-open the same invite link as an existing member.
3. Leave a group.
4. Send a DM.

Then clean up tokens that were already exposed in the user directory (needs a service-account key kept outside the repo). **Dry run first:**

```bash
npm i --no-save firebase-admin
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/migrate-invite-tokens.mjs
# then add --apply to remove the field, and --revoke-exposed to also close the live links
```

`--revoke-exposed` also kills links you meant to keep; make fresh ones afterwards. Deleting the field does **not** un-leak a token someone already copied — only revoking does.

Last seen on `main` (`2adab7c`): main Worker build passed; gifs Worker build and Vercel still running. Re-check them.

## 2. What shipped (PRs #1–#3, all merged)

**#1 — UI and logo**
- `--ink-dim` raised to ≥4.5:1 on every surface (was 3.45:1 on dark); Android palette matched.
- Day dividers, time-only headers, hover time on follow-on messages, jump-to-latest pill with unread count, stable group keys.
- Mention/pinned rows marked by tint instead of a coloured left border; accessible names on icon-only buttons.
- PUNX wordmark on the login (44px tile, zoomed so it reads) and as the favicon.

**#2 — review fixes**
- *Firestore rules* (5 holes, each exploit written as a test first; 24 of 46 new tests fail on the old rules): any member could become group admin in two writes; an admin could impersonate a developer through the bot registry; invite tokens were path fragments; DMs could be squatted and tampered with; message authors could pin/forge their own messages. Group admins can now list their invites.
- *Worker* (had no tests, now 18): `cutoffId` path injection / mask-dropping, unknown `kind` skipping the sent-guard, partly failed DTR sends marked complete, constant-time secret check, junk tokens 401 not 500, bot-token issuer refuses non-bot uids.
- *Voice (web)*: retry cap never bound (counter reset to `-1`); the answerer takeover could never work. `docs/VOICE.md` corrected (it also overstated Android self-repair).
- *Web*: a message with non-string `text` blanked the whole app (error boundary added); busy channels never marked read; notification replay/dedupe/reload; pill counting bugs; `--brand-text` token (brand text was 3.6:1 on dark); composer and edit-box fixes.

**#3 — invite token leak**
- The token was stored on `users/{uid}` (readable by every signed-in account), so any employee could copy another person's token and join their group — reproduced end to end, then refused. It now lives in `users/{uid}/private/invite`, which nothing can read. `scripts/migrate-invite-tokens.mjs` cleans existing documents.

**CI fix** — Cloudflare's build ran `npm run build` in `workers/`, which had no such script, so every branch build failed. Added `"build": "wrangler deploy --dry-run --outdir dist"`.

Rules suite: **204 passing** (143 original). Worker suite: **18 passing**.

## 3. Found but not fixed

- `isGroupAdmin()` ignores membership (a `members:manage` bot can leave an admin in `adminUids` after removing them from `memberUids`).
- **@mention notifications are denied by the rules** (both clients swallow the error). A safe fix needs a collection-group rule keyed on `mentionedUids` plus an index.
- **iOS cannot start**: `GoogleService-Info.plist` is not referenced by `ios/Runner.xcodeproj`, and `firebase_options.dart` has no iOS options. Needs an iOS app registered in the Firebase console first. CI now refuses to build a *signed* .ipa without the plist secret, but that only reports the problem.

### Flutter fixes made afterwards (in the working tree, not committed or pushed)

Checked by `flutter analyze` (clean) and unit tests only. No Android SDK here, so none of it has been built into an APK or run on a phone.

- Foreground service: claimed `camera` every time, which Android 14+ refuses without the camera permission — and the plugin *returns* failures instead of throwing, so the failed start was never even logged. Now microphone-only, camera added only while the camera is on, results checked and logged.
- Voice session outliving its account: heartbeat now leaves on `permission-denied` (removed / revoked / deactivated); signing out or deactivation ends the session; teardown can no longer be aborted halfway by one refused delete.
- Voice self-repair on Android: ported from the web (`voice_pair_health.dart`, 6 tests including the retry-cap regression).
- `BLUETOOTH_CONNECT` is requested at runtime when joining voice.
- Android brand text now uses a `brandText` token (5.7:1 on the raised dark surface; the fill colour was 3.3:1).
- Release builds fail without `key.properties` instead of signing with the debug key; `ALLOW_DEBUG_SIGNED_RELEASE=1` opts back in. **The Gradle check was not run** — if `flutter build apk --release` misbehaves, look at `gradle.taskGraph.whenReady` in `android/app/build.gradle.kts`.
- The "callee gets no media on a 1:1 call" suspicion was traced and is **not a bug** (`ActiveCallView` re-reads the stream from state on every build).

To confirm on a phone: join voice without granting camera and background the app (audio must continue); drop one phone's network mid-call and look for `[voice] pair ... stalled; re-offering`; remove a test account from the group while it is in a channel.
- Presence heartbeats go through one shared `users` subscription, re-rendering the whole message list and costing reads at scale.
- Smaller: failed Firestore listeners show an empty chat, not an error; no CSP / security headers; GIF favourites shared across accounts on one browser.

## 4. Decisions

- **Viber: dropped.** A bot bridge was built and tested, then removed — new Viber bots are commercial (≈EUR 100/month, per third-party sources, not verified), and Viber has no official personal-account API. Don't re-propose personal-account bridging.
- **30 people in one voice channel** (all talking, 1–2 screen shares) needs an SFU; the mesh doesn't scale (a share sender would upload ≈35 Mbps; a full-room join is ≈10,000 candidate writes). Recommended LiveKit Cloud (rooms, Flutter SDK, screen share); Cloudflare Realtime SFU is cheaper but needs a hand-written client on both platforms. Scoped, **not built**; waiting on a provider choice.

## 5. How to run things on this machine

- Rules tests need Java, which is **not** on PATH. A portable JDK 21 is at `C:\Users\ReyPunx\tools\jdk21\jdk-21.0.12.1+1`. From **PowerShell** (Git Bash mangles the Windows PATH):

  ```powershell
  $env:JAVA_HOME = "C:\Users\ReyPunx\tools\jdk21\jdk-21.0.12.1+1"
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"; $env:CI = "true"
  npm i --no-save --legacy-peer-deps @firebase/rules-unit-testing firebase-admin
  npx firebase emulators:exec --only firestore --project punx-rules-test "node tests/rules.test.mjs"
  ```

  Install **both** libraries in one command: installing either `--no-save` package alone prunes the other, and the suite then dies with `ERR_MODULE_NOT_FOUND` (it looks like a rules failure; it isn't).
- Worker tests: `npm test` in `workers/`.
- `firestore.rules`, `tests/rules.test.mjs` and `docs/ROLES.md` use CRLF line endings; multi-line edits need a script that normalises and restores them.

## 6. Android release build and signing (2026-10-15)

- **The release keystore is on the user's OTHER PC**, not this one. This machine has no `android/key.properties` and no release `.jks` — only the debug key. A Play-uploadable AAB has to be built on the other PC, or the keystore and `key.properties` copied here (both are gitignored; never commit them). Do not generate a new keystore: if the app is already on Play, a different key is rejected as an update, and a lost key has no recovery.
- Where `key.properties` points (`storeFile=`) is a path on the other PC; check it there. `docs/RELEASE.md` has the format.
- **Android SDK is now installed here**: `C:\Users\ReyPunx\tools\android-sdk` (cmdline-tools, platforms 34/35/36, build-tools 36.0.0, CMake 3.22.1, NDK via Gradle), licences accepted, and `flutter config` points at it and at the portable JDK 21.
- Build from PowerShell with `JAVA_HOME` set to the JDK 21 path above and `ANDROID_HOME` set to the SDK. First build is slow (~8 min); later ones ~5.
- Verified on a real Gradle run (PR #4): a release build with no `key.properties` fails with the new message; with `ALLOW_DEBUG_SIGNED_RELEASE=1` it produces `build/app/outputs/bundle/release/app-release.aab` (75.2 MB), signer `CN=Android Debug` — **not uploadable to Play**. Debug builds were not tried.
- Still never run on a phone: the voice changes in PR #4 (see the four checks in its description).

## 7. Flutter UI port (branch `claude/flutter-ui-port`, stacked on PR #4)

Ported from the web so the app matches it: day dividers ("Today", "Yesterday", "Tuesday, March 4"); time-only message headers (device 12/24h setting); jump-to-latest pill with an unread count and the same counting rules as the web (your own message scrolls you down, deleting the newest is not "new", older pages landing at the top are not "new", a channel switch resets it); pinned and @mention rows marked by tint instead of a coloured left border; the PUNX wordmark on the login screen; read-marking that no longer starves in a busy channel (the 400 ms debounce was being pushed back by every message — now it fires once per burst); tolerant message parsing (one malformed field used to throw inside the snapshot stream and take the whole chat down, the same crash the web had); tooltips / accessible names on 8 icon-only buttons.

Layout across devices: the login screen overflowed on a 320dp phone at normal text size and at every width once text was scaled up (fixed; it also scrolls now), the chat column is capped at 840dp on wide screens, and wide screens (>= 720dp, tablets or a phone in landscape) get a side navigation rail instead of the bottom bar.

Checked: `flutter analyze` clean, 132 tests pass. New widget tests render the message list at 7 sizes (320x568 up to 1280x800, including landscape) and the login at 6, each at 1x/1.5x/2x text, and fail on any overflow. The varied-row-height scroll test failed against the old scroll-to-end (10.8 px short) and passes now.

NOT checked: no test renders `AppShell`, so the new side rail has only been analyzed, not seen. Nothing has been run on a phone or tablet; tests catch overflow and logic, not how it looks. The launcher icon is unchanged: the app already has its own yellow PUNX icon, which differs from the black wordmark used on the web login. iOS is untouched and still cannot start (no Firebase config for it).
