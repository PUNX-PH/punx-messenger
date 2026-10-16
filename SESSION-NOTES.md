# Session notes — 2026-10-14 to 2026-10-16

What was done, what is still waiting on you, and what was found but not fixed.

## 1. Where things stand (updated 2026-10-16)

PRs #1–#9, #11–#17 are merged (#10 was closed unmerged). Up to #13 (`2e15ef0`) I checked the deploy: Vercel and both Cloudflare Workers builds succeeded and https://plexus.punxai.online/ served it (the split bundle and its on-demand parts, the sound files, and the one-day cache on built files, section 13). **#15 (chat re-renders, section 14) and #16 (background blur, section 15) are merged to `main` (`f79b3c5`); their PR checks, including the Vercel build, were green, but I have not looked at the production deploy or the live site since, and neither has been tried in the signed-in app.** #14 was the notes, and #17 added CI and `CLAUDE.md` (section 16).

**Done in production**
- Firestore rules deployed to `punx-msg`; new guests can redeem invites again. The rules on `main` were later corrected on the other PC, because the ones I wrote exceeded Firestore's 1000-expression budget (section 3), and per that commit's message they were deployed from there.
- Invite-token migration run with `--apply --revoke-exposed`: `invitedVia` removed from 3 user documents, the one live exposed invite (the "Test" group, channels general/test/music) revoked. A re-check reads 0 exposed tokens. Anyone who still needs that group needs a fresh link.
- The Android app is being distributed through Google Play: release commits 1.1.0 and 1.2.0 are on `main`, built on the other PC, along with registering the Play signing certificate in Firebase (Google sign-in failed for Play-installed builds without it).

**Still to do, in order**

1. **Smoke-test the real app against the live rules.** I only ever ran the emulator suite; I never confirmed these on the real app (the other PC may have). The first matters most:
   1. Redeem an invite as a brand-new Google account.
   2. Re-open the same invite link as an existing member.
   3. Leave a group.
   4. Send a DM (web, and the Android app).
   If one fails, roll back: check out `firestore.rules` from before PR #2 (`git log -- firestore.rules`) and redeploy it.
2. **Check the Android changes on a phone, on the other PC** (which has the release keystore; do not build Android on this machine). Nothing from PRs #4, #5, #7, #9 and #11 has been run on a device by me, and the app has not been compiled with Gradle since the audio plugin and the invite screen were added. Checks, all still to do: voice in the background, network drop, removed account (section 6); the side rail on a tablet (7); **create an invite from the app, open the link in a browser, and join** (8); the sound checks, above all that **call audio does not change when a sound plays on speakerphone** (9); status dots in the DM list, members sheet and message authors (11).
3. **iOS: prepared, needs a Mac.** `docs/IOS.md` has the ordered runbook and device checklist; `node scripts/ios-setup.mjs` checks the project and, with `--apply`, wires the Firebase file in once you have it (section 12). Still missing: `GoogleService-Info.plist` (create/fetch with the Firebase CLI after `firebase login --reauth`; the login on this machine has expired), a signing team, and any run on a device. Decision pending: Sign in with Apple, before App Store review.
4. **On the signed-in web app, open the on-demand parts once** (emoji picker from the composer and from a message's reaction button, with its GIF tab; admin panel; a voice room; group settings, channel access and create-group dialogs). They were wired in but I could not sign in to try them (section 11).
5. **Try background blur in a real call** (section 15): the button in a voice channel and in a video call, on and off while the camera runs, a real person (is the cut-out clean around hair and glasses?), two browsers, and Safari and Firefox. The first use downloads about 12 MB and takes several seconds.
6. **Check a busy chat in the signed-in web app** (section 14): the typing indicator appears and disappears, edit, delete, react, reply and pin still work, and the scroll position holds when loading older messages.
7. The open items in section 3, and the choice of an SFU provider for 30-person voice (section 4).

### Running the migration script again

The script takes either a service-account key (`GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`) or an `authorized_user` credential file. The second was used here: a file built from the Firebase CLI login (`~/.config/configstore/firebase-tools.json` refresh token, the client id/secret from `node_modules/firebase-tools/lib/api.js`, and `"quota_project_id": "punx-msg"`). Keep such a file outside the repo and OneDrive, and delete it afterwards. Re-running the script is free; a second pass finds nothing.

In the user's own Terminal tab PowerShell blocks `npx`; use `npx.cmd`.

## 2. What shipped (PRs #1–#17)

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

**#4 — Android voice and release fixes** (details in section 6): background voice no longer dies on Android 14+ (the foreground service claimed the camera type unconditionally and its failure was never logged); the heartbeat leaves a channel the rules refuse, and sign-out or deactivation ends a call; stalled voice pairs are repaired like on the web; Bluetooth permission requested; brand text contrast; release builds fail without `key.properties`.

**#5 — Flutter UI port** (section 7): day dividers, jump-to-latest pill, tint instead of coloured borders, wordmark on login, tolerant message parsing, read-marking that works in a busy channel, login overflow fixed on small phones and large text, a side rail on wide screens.

**#6 — migration script and notes**: `scripts/migrate-invite-tokens.mjs` accepts a signed-in person's credential, not just a service-account key.

**#7 — sound effects** (section 9, `docs/SOUNDS.md`): calls, DM ping and voice-channel sounds, web and Android, with a per-device switch.

**#8 — notes**: this file, brought up to date.

**#9 — Android invite links screen** (section 8): admins create, copy and revoke a group's invite links from Group settings; reads and writes the same documents as the web.

**#10 — superseded and closed unmerged**: its "picking this up on another machine" section is folded into section 10, and its other edits described a state that no longer existed.

**#11 — speed pass** (section 11): presence heartbeats no longer re-render the whole app (web and Android); the web bundle is split; a failed on-demand load cannot take the app down.

**#12 — iOS preparation** (section 12): everything for a first iOS build that can be done without a Mac, an ordered runbook, and a readiness script with tests.

**#13 — caching** (section 13): built files cached for a day instead of re-checked on every load.

**#14 — notes** (this file).

**#15 — chat re-renders** (section 14): an open chat no longer re-renders and re-parses every message every 2 seconds or on every snapshot.

**#16 — background blur** (section 15): a "Blur your background" button for the camera in voice channels and video calls (web only).

**#17 — CI and `CLAUDE.md`** (section 16): the tests now run on every PR and on `main`.

Test counts on `main` at the end: **Flutter 238**, **Node 142** (sound, presence identity, lazy loader, iOS setup, chat identity, camera), Worker 18, Firestore rules 204 (with the caveat in section 3).


## 3. Found but not fixed, and corrections

**A correction to something I reported.** I said the Firestore rules suite had 204 passing tests. Seventeen of those passed for the wrong reason: Firestore was giving up with "the maximum of 1000 expressions to evaluate has been reached", which denies the request, and an assertion that something is denied cannot tell that from a real refusal. So the attacks those tests describe were not actually being evaluated, and a legitimate request (an ordinary member posting in a channel) was one helper call away from being denied in production the same way. The other PC found and fixed it (commit `ff4af1d`: helpers now bind what they read, no rule changes meaning) and made the suite fail loudly on it from now on. Treat the 204 as real only from that commit.

**Open**
- `isGroupAdmin()` ignores membership (a `members:manage` bot can leave an admin in `adminUids` after removing them from `memberUids`).
- **@mention notifications are denied by the rules** (both clients swallow the error). A safe fix needs a collection-group rule keyed on `mentionedUids` plus an index.
- **Presence still costs reads**: Firestore delivers every heartbeat to every client, and that grows with the square of the number online (section 11 fixed the re-rendering, not the reads). The real fix is to move presence out of the `users` collection.
- Failed Firestore listeners show an empty chat instead of an error.
- No Content-Security-Policy or other security headers.
- GIF favourites are shared between accounts on one browser.
- **Not in the Android app compared with the web:** opening an invite inside the app (the link opens in the browser), GIF favourites, and sharing your screen (Android can only watch one; sending needs the screen-capture permission and a foreground service type).
- **Background blur is web only**: the Android and iOS apps use a different camera pipeline and would need a native segmentation model (section 15).
- **iOS cannot start** until the Firebase iOS config exists and it has been built once on a Mac: section 12.

**Fixed since the first review** (all merged in #4, details in section 6): the foreground-service camera type that likely killed background voice on Android 14+; removed accounts keeping their voice session; no voice self-repair on Android; `BLUETOOTH_CONNECT` never requested; release builds signing with the debug key; the Android brand-text contrast. The "callee gets no media on a 1:1 call" suspicion was traced and is **not a bug** (`ActiveCallView` re-reads the stream from state on every build).

## 4. Decisions

- **Viber: dropped.** A bot bridge was built and tested, then removed — new Viber bots are commercial (≈EUR 100/month, per third-party sources, not verified), and Viber has no official personal-account API. Don't re-propose personal-account bridging.
- **Sign in with Apple: undecided.** Needed before App Store review if Apple's guideline 4.8 applies (section 12).
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


### What PR #4 changed on Android

Checked by `flutter analyze` and unit tests only; the one thing run for real was the release-signing check above.

- Foreground service: claimed `camera` every time, which Android 14+ refuses without the camera permission, and the plugin *returns* failures instead of throwing, so the failed start was never even logged. Now microphone-only, camera added only while the camera is on, results checked and logged.
- Voice session outliving its account: the heartbeat now leaves on `permission-denied` (removed / revoked / deactivated); signing out or deactivation ends the session; teardown can no longer be aborted halfway by one refused delete.
- Voice self-repair on Android, ported from the web (`voice_pair_health.dart`, with the retry-cap regression tested).
- `BLUETOOTH_CONNECT` is requested at runtime when joining voice.
- Android brand text uses a `brandText` token (5.7:1 on the raised dark surface; the fill colour was 3.3:1).
- Release builds fail without `key.properties` instead of signing with the debug key; `ALLOW_DEBUG_SIGNED_RELEASE=1` opts back in.

To confirm on a phone: join voice without granting the camera and background the app (audio must continue); drop one phone's network mid-call and look for `[voice] pair ... stalled; re-offering`; remove a test account from the group while it is in a channel.

## 7. Flutter UI port (PR #5, merged)

Ported from the web so the app matches it: day dividers ("Today", "Yesterday", "Tuesday, March 4"); time-only message headers (device 12/24h setting); jump-to-latest pill with an unread count and the same counting rules as the web (your own message scrolls you down, deleting the newest is not "new", older pages landing at the top are not "new", a channel switch resets it); pinned and @mention rows marked by tint instead of a coloured left border; the PUNX wordmark on the login screen; read-marking that no longer starves in a busy channel (the 400 ms debounce was being pushed back by every message — now it fires once per burst); tolerant message parsing (one malformed field used to throw inside the snapshot stream and take the whole chat down, the same crash the web had); tooltips / accessible names on 8 icon-only buttons.

Layout across devices: the login screen overflowed on a 320dp phone at normal text size and at every width once text was scaled up (fixed; it also scrolls now), the chat column is capped at 840dp on wide screens, and wide screens (>= 720dp, tablets or a phone in landscape) get a side navigation rail instead of the bottom bar.

Checked: `flutter analyze` clean, 132 tests pass. New widget tests render the message list at 7 sizes (320x568 up to 1280x800, including landscape) and the login at 6, each at 1x/1.5x/2x text, and fail on any overflow. The varied-row-height scroll test failed against the old scroll-to-end (10.8 px short) and passes now.

NOT checked: no test renders `AppShell`, so the new side rail has only been analyzed, not seen. Nothing has been run on a phone or tablet; tests catch overflow and logic, not how it looks. The launcher icon is unchanged: the app already has its own yellow PUNX icon, which differs from the black wordmark used on the web login. iOS is untouched and still cannot start (no Firebase config for it).

## 8. Android invite links screen (PR #9, merged)

Group admins can now create, copy and revoke invite links from the app (Group settings -> Manage invite links), the same as the web's Group Invites. Reads and writes the same `invites/{token}` documents, with the same shape the rules check; revoking asks first, which the web does not. The links open in the browser, where a guest signs in and joins: **joining from inside the app is not built** (it needs deep links and the guest sign-up flow, and touches the rules we just tightened).

Links point at `AppConfig.webOrigin`, which defaults to `https://plexus.punxai.online`; override with `--dart-define=WEB_ORIGIN=https://...` for a staging site. The web builds links from whichever address the admin has open, so check the default is the address you want people to receive.

Checked: `flutter analyze` clean, 169 tests pass. Tests cover the model, the token (43 URL-safe chars from a secure generator, 256 bits), the exact payload against what the web writes and the rules read, and the screen (permissions, create + copy, revoke with and without confirming, expired/revoked labelling) at 5 screen sizes at 1x and 2x text. Two deliberate breakages (a 42-char token, revoking without confirming) were each caught by a test. NOT checked: nothing has run against the real Firestore, on an emulator or on a phone; the payload matches the web's and the rules tests cover that shape, but the app itself has not written one.

**First real test:** create an invite from the app, open the link in a browser, sign in and join. Opening an invite inside the app is not built (list of what the app lacks versus the web: section 3).

## 9. Sound effects (PR #7, merged)

Calls (ring, ringback, connected, ended), new DMs (ping) and voice channels (your own join/leave, plus a quiet tick when others come and go), on the web and on Android, with an on/off switch per device. Full description, file map and how to change a sound: `docs/SOUNDS.md`.

The sounds are generated, not recorded (`scripts/generate-sfx.mjs` writes `public/sfx` and `android_app/assets/sfx`), so there is nothing to license. They are plain tones; swap in your own files if you want a particular character.

**Checked here:** 65 web tests (the audio itself: no clicks, loops end in silence, right pitches, join rises / leave falls; the player; the rules for when each plays) and 36 Android tests (service, rules, preference, bundled files identical to the web's). `flutter analyze` clean; the web app builds. In a real browser pane the files load with the exact durations, the ring loops, stop rewinds it, one-shots finish. The tests were themselves checked by breaking the code on purpose (a wrongly-pitched sound, four player rules, and five Android rules) and confirming a test caught each. One survived at first (a disabled ring being remembered, which only matters once the ring has played before); the test was strengthened and it is now caught.

**NOT checked, and the Android build was deliberately NOT run on this machine (it is built on the other PC):**
- The Android app has not been compiled with the new `audioplayers` plugin, so build it first and watch for Gradle errors.
- Nobody has heard any of it. The tests measure the audio; whether it sounds good is for ears.
- The browser-autoplay "blocked then retried on click" path was only tested with a fake `Audio`; the pane used here allows autoplay.

**On the phone, in this order:**
1. Build and install; open the app. Profile sheet -> "Sound effects" should be on. Toggle it off and on: turning it on plays a ping.
2. DM: have someone message you while you are on another screen -> ping. Open that conversation and have them message again -> no ping. Background the app -> the normal system notification, no in-app ping.
3. Call someone, and be called: ring on the callee, softer ringback on the caller; both stop when answered, followed by the connected chime. Hang up -> ended chime. Decline an incoming call -> silence.
4. Voice: join a channel -> join chime; have someone else join/leave -> a quiet tick; leave -> leave chime. Deafen yourself -> no ticks.
5. **The one that matters most:** while in a voice channel on **speakerphone**, make a sound happen (someone joins, a DM arrives). The call audio must not drop, switch to the earpiece, or change volume. The audio package can change the phone's global audio mode; the app configures every player once at startup to avoid that (`docs/SOUNDS.md`, "Android audio mode"). If this check fails, that is the first place to look.
6. Silent / Do-not-disturb: the ring should follow the ringer volume; the UI sounds follow the system-sounds volume.

Also on iOS (see `docs/IOS.md`): the sounds use the `ambient` audio category (respects the silent switch, mixes with other apps) and are held back while a call or voice channel has live audio (`playSoundsDuringLiveAudioOnIOS = false` in `lib/services/sfx_service.dart`). Reason: the audio package activates and deactivates the shared audio session as sounds start and stop, which during a call is WebRTC's session too, and whether that can cut call audio cannot be known without a device. Unverified; the test to flip it is in `docs/IOS.md`. (An earlier version of this note said `playAndRecord`; that was changed.)

## 10. Picking this up on another machine

**Everything is on GitHub.** All work from this stretch is merged to `main`, except PR #10, which was closed because this file supersedes it. There were no stashes and no uncommitted changes when this was written. If you have another checkout, `git pull` on `main` first.

**What is NOT in the repo, and has to be set up again:**
- **Secrets.** The Android release keystore and `android/key.properties` (on the other PC, never in git); any Firebase service-account key; the Cloudflare, Vercel and GitHub sign-ins. Run `gh auth login` and `firebase login` on the new machine (in the user's own PowerShell use `npx.cmd`, since script execution is disabled there).
- **Tools.** Node, Flutter, Java 17+ and the Android SDK. On this machine they were a portable JDK 21 at `C:\Users\ReyPunx\tools\jdk21\jdk-21.0.12.1+1` and the Android SDK at `C:\Users\ReyPunx\tools\android-sdk`; neither exists elsewhere unless installed. Then `npm i` and, in `android_app/`, `flutter pub get`.
- **The assistant's saved memory** (what it remembered between sessions) lives in the user profile on this machine, not in the repo. Everything in it that matters is in these notes; the essentials: Viber is dropped (section 4); the release keystore is on the other PC (section 6); **do not build the Android app on a machine without the keystore**, run `flutter analyze` and `flutter test` there, and list anything needing Gradle or a phone as a to-do.

**Running the checks**
- **All of the below run in CI** (`.github/workflows/ci.yml`, section 16), so a PR's checks show them. Web: `npm run build` (and `npm run dev`) first copies the blur model into `public/mediapipe/` (gitignored; needs `npm i` to have run). Node tests: `node --test tests/sfx.test.mjs tests/sfx-player.test.mjs tests/users-identity.test.mjs tests/lazy.test.mjs tests/ios-setup.test.mjs tests/chat-identity.test.mjs tests/camera.test.mjs`.
- Worker: `npm test` in `workers/`.
- Firestore rules: see section 5 (needs Java, and the two test libraries installed together).
- Flutter: in `android_app/`, `flutter analyze` and `flutter test`. The widget tests render at several screen sizes and fail on any overflow.
- iOS readiness: `node scripts/ios-setup.mjs`.

**Habits that bit during this work**
- Merge PRs with a **merge commit, not squash**. For stacked PRs, retarget the next one to `main` after its base merges, and do **not** delete a base branch (`--delete-branch`) while another PR still targets it: that closes the dependent PR.
- Two open PRs that both change this notes file will conflict (one appended a section, the other edited a line beside it). Edit lines in place, or expect to resolve it; GitHub can take several seconds to say `UNKNOWN` before it reports `CONFLICTING`.
- `main` auto-deploys the web app (Vercel) and Workers (Cloudflare) on every merge, including docs-only ones (identical code, but still a deploy). **Firestore rules do not auto-deploy**; they go out with `firebase deploy --only firestore:rules --project punx-msg`.
- Vercel preview URLs are behind Vercel's login, so a preview's headers cannot be read from outside; verify on production after merge.
- Several files are CRLF on Windows (`firestore.rules`, `tests/rules.test.mjs`, `docs/ROLES.md`, most Dart files): a multi-line edit that ignores that fails silently. `dart format` over the whole project rewrites dozens of unrelated files; format only the files you changed.
- Write commit messages and PR bodies to a file (`git commit -F`, `gh pr create --body-file`) and delete the file afterwards; `git add -A` has swept a temp file into a commit once, so `git reset` it before committing.
- In PowerShell, parse `gh ... --json` with `ConvertFrom-Json`; `--jq` quoting breaks.

## 11. Speed and QoL pass: presence re-renders and the web bundle (PR #11, merged)

**Presence stopped re-rendering the whole app (web and Android).** Every client listens to the whole `users` collection and every online person rewrites `lastSeen` every 45 seconds, so each heartbeat arrived as a snapshot that rebuilt the lookup tables and re-rendered everything reading them: the message list, composer, both sidebars. Measured with the real provider in a browser (10 people, simulated): **40 heartbeats re-rendered each consumer 40 times before and 0 times now; other people reading channels went from 10 renders to 0.** A rename, a role change, a deactivation and *my own* `lastRead` still re-render exactly once each. People now keep the same object until something the UI shows changes (`src/lib/usersIdentity.js`, `android_app/lib/services/users_identity.dart`); presence travels separately (`usePresence()` / `presenceStoreProvider`) and is published at most once per 15 s. **The trade:** a status dot can now lag a heartbeat by up to 15 s (statuses are measured in minutes, so this is invisible in practice). **What it does not change:** Firestore still delivers every heartbeat to every client, so *reads* are the same; at ~24 people that is a small cost, but it grows with the square of the number online. The real fix for that is moving presence out of the `users` collection (a separate presence document, or Realtime Database, which is built for this); not done, because it needs rules and a migration.

**The web bundle is split.** Before: one 920 KB file (247 KB gzipped). Now: the app's own code (234 KB / 70 KB gz), React (166 / 54) and Firebase (462 / 109) as separate files, plus six on-demand parts: admin panel, voice room, emoji picker (with the GIF panel), and the three dialogs. Honest numbers: a **first visit** downloads about the same (247 -> 233 KB gz, -6%); the win is **returning visitors after a deploy**, who re-download only the app's code, about **70 KB instead of 247 KB (-72%)**, because React and Firebase stay cached. The emoji picker and voice room are fetched in the background a couple of seconds after the app is up, so opening them is instant; the admin panel and dialogs load on first use. The emoji picker used to sit hidden inside **every message row**; it now exists only while open.

**A failed on-demand load cannot take the app down.** After a deploy, a tab left open since before it asks for files that no longer exist. `LazySlot` catches that locally: a small notice with Reload (a lazy load that failed cannot be retried, only reloaded), or Try again if the part loaded and then crashed. It does not reach the top-level error boundary, which would end a call or voice session.

**Checked:** 89 Node tests (identity, lazy loader, plus the sound suites), 228 Flutter tests, a clean analyzer and web build. The tests were themselves checked by breaking the code on purpose: 8 breakages in the web identity and loader code (heartbeat fields kept, identity never reused, my own `lastRead` dropped, others' `lastRead` treated as news, a failed load cached forever, a missing file not recognised, an ordinary crash mistaken for one, the background preload not waiting) and 4 in the Android presence code (the original bug re-introduced, identity never reused, a rename not noticed, batching removed). All are caught; one (the preload not waiting) survived at first and its test was strengthened. In a real browser: the production build's login page loads exactly four files (about 235 KB) and none of the on-demand parts, with no console errors; the loader and `LazySlot` were exercised against a slow load, a deleted file and a render crash. One thing that exercise caught and I fixed: dismissing a "couldn't load" notice used to bring it straight back.

**NOT checked:**
- **The real signed-in web app.** The on-demand parts (admin panel, voice room, emoji picker in the composer and on messages, settings, channel access and create-group dialogs) were wired in but I cannot sign in here, so none was opened in the real UI. After deploy, open each once. The emoji picker in particular: open it from the composer, from a message's reaction button, and check the GIF tab.
- **Android:** compiled by `flutter analyze` and tested, but not built with Gradle or run on a device (built on the other PC). Check the members sheet, DM list dots and message author dots still show the right status.
- Real Firestore: the presence batching was tested against a stand-in stream, not live data.

**Not done, in rough order of value (the memoised message list was done afterwards, section 14):** move presence out of `users` (read cost, above); failed Firestore listeners show an empty chat instead of an error; no Content-Security-Policy or other security headers; GIF favourites are shared between accounts on one browser.

## 12. iOS preparation (PR #12)

The iOS app has never been compiled or run. This PR closes every gap that can be closed without a Mac and writes down the rest; the ordered runbook is `docs/IOS.md`.

**Found and fixed:** the Podfile did not switch on `permission_handler`'s notifications (so notifications could never be enabled on iOS and it reported "denied" silently); no `NSPhotoLibraryUsageDescription`; no Google sign-in URL scheme (Google sign-in would crash instead of returning to the app); and the Firebase plist would not have been in the app even if present (the Xcode project never copied it). The last two are done by `node scripts/ios-setup.mjs --apply` once the plist exists; the first two are already committed. The iOS sound-effect audio settings were also changed: the audio package sets the `playback` category at launch (ignores the silent switch) and deactivates the shared audio session when a sound ends (which during a call is WebRTC's), so iOS uses `ambient` and holds sounds back during live call/voice audio behind `playSoundsDuringLiveAudioOnIOS = false` until tried on a device. Android is unchanged.

**`scripts/ios-setup.mjs`** checks (and with `--apply`, wires in) the Firebase plist, the URL scheme, usage strings, background audio, the Podfile, every bundle id and deployment target, and that `project.pbxproj` is well-formed; a missing signing team is a warning, since only a person can set it. On the real project today: one blocking item (no plist), two waiting on it, one for the Mac. The CI workflow runs it.

**Checked:** 30 tests against a copy of the real iOS project. Writing them found a real bug in the script's first version (it put the plist in the *test* target's resources instead of the app's); after the fix an independent pbxproj parser confirmed the plist lands in the Runner target and the project still parses, and the edited `Info.plist` is valid XML. Seven deliberate breakages of the script were all caught. The Firebase CLI commands in the runbook were checked against the installed CLI's flags.

**NOT done, and why:** no `GoogleService-Info.plist` (nothing in the repo is registered as an iOS app, and the CLI login on this machine had expired, so I could not even list the project's apps); no signing team; no compile or run (Mac only). The Podfile edit is Ruby and was never executed (no Ruby here); `pod install` is its first real test. The sound-effects guard is reasoned from the audio package's source, not heard on an iPhone. **Sign in with Apple is undecided**: Apple's guideline 4.8 may apply (Google-only sign-in, and guests can join with any Google account), and I did not verify how Apple would read it; decide before App Store review.

## 13. Caching built files (PR #13)

The live site sent every built file with `Cache-Control: public, max-age=0, must-revalidate`, so the browser made a round trip per file on every load to check it was unchanged. `firebase.json` already had a rule, but the site runs on Vercel and Cloudflare, where it does not apply. `vercel.json` and `public/_headers` (Cloudflare) now send `public, max-age=86400` for `/assets/`. Not `index.html` (it names the current files), and not `/sfx/` (those names carry no hash).

**One day, not a year with `immutable`, on purpose.** Running `vercel.json` through Vercel's own routing library showed the rule applies to every `/assets/` URL including ones that no longer exist, and this app rewrites unknown URLs to `index.html`, so a stale tab asking for a deleted file gets a 200 with HTML. With a year-long lifetime the browser would keep that wrong answer for a year, which bites if a rollback later brings that file name back. A day bounds it.

**Verified on production after the deploy:** built files `max-age=86400`; `index.html` and `/dms` still `max-age=0, must-revalidate`; `/sfx/ring.wav` and the logo untouched. In a real browser a direct fetch of the main app file transferred 0 bytes (about 7 ms, served from cache), while the ring sound, which still revalidates, took a 300-byte check costing about 69 ms. So the saving is roughly one round trip per visit (the files load in parallel), on that connection and from one measurement, **not bytes**: unchanged files were already answered with a bodyless 304. A whole-page reload in the in-app browser pane still showed the small checks; that pane does not seem to treat reloads like a normal browser, so I trust the direct fetch. To undo, revert PR #13.

## 14. Open chats stopped re-rendering every message (PR #15)

**The problem.** `ChatSurface` ran a timer every 2 seconds, in every open conversation, to age out the typing indicator. Each tick re-rendered the whole message list and re-parsed the markdown of every message on screen, whether or not anyone was typing. On top of that every Firestore snapshot rebuilt every message object, so the list could not tell "one new message" from "everything changed".

**The fix.**
- `src/lib/typing.js`: `whoIsTyping` also says when the answer will next change, and the chat sleeps until then. An idle chat does no work.
- `src/lib/messagesIdentity.js` + `listenMessages` (`src/lib/db.js`): a message Firestore did not report as added or modified (`docChanges()`) keeps the same object. Growing the window with "load earlier messages" recreates the listener, so that one render still rebuilds every row.
- `MessageList.jsx`: `Row` and `Group` are `memo`, blocks are built only when the messages change, and only the first row of a group is given the author. `ChatSurface.jsx` handlers are `useCallback`.

**Checked.** 12 tests (`tests/chat-identity.test.mjs`); six deliberate breakages caught. Measured in a browser with 200 messages by counting reads of `message.text`, old `MessageList` from `main` against the new one: five parent re-renders **4,335 reads -> 0**; one new message **1,738 -> 4**.

**NOT checked.** Not run in the signed-in app (I cannot sign in). After deploy, in a busy channel: the typing indicator appears and disappears, edit, delete, react, reply and pin, and scroll position when loading older messages. A status dot on an unchanged row now updates when its group re-renders (every 30 s), not on every render. Presence *reads* are unchanged (section 11).

## 15. Background blur (PR #16)

**What.** A "Blur your background" button beside the camera button in voice channels (`VoiceStatusBar`) and in the video-call controls (`CallOverlay`). The person stays sharp and everything behind them is blurred. It can be turned on or off while the camera runs, or set first. The choice is remembered per browser (`src/lib/useBlurPref.js`, localStorage) and shared by both buttons.

**How.**
- `src/lib/backgroundBlur.js`: MediaPipe selfie segmentation (the "landscape" model) on the GPU says which pixels are the person; the person is drawn over a blurred copy of the frame on a canvas, and the canvas is captured as a new video track. Browsers without canvas filters (older Safari) blur by shrinking and stretching back. A worker timer drives it, because `requestAnimationFrame` stops and page timers are cut to once a second in a hidden tab, which would freeze your picture the moment you switch tabs mid-call. It waits for the first blurred frame (10 s limit) before handing over the track, so a failure surfaces rather than sending black.
- `src/lib/camera.js`: the camera with blur switchable while it runs. The caller sends `camera.track` and, after `setBlur`, swaps with `replaceTrack` (no renegotiation). Calls are serialised, and closing the camera mid-start does not leak the processor.
- `useVoiceChannel.jsx` and `useCall.jsx`: blur is applied **before** the first frame is sent, so the room is never shown while the model starts. If blur cannot start, the plain camera is used, the person is told, and the setting is switched off. In a 1:1 call the camera's own track follows the on/off button, so a blur turned on later does not revive a camera that was switched off.
- **Assets.** `@mediapipe/selfie_segmentation` (Apache-2.0, a devDependency). `scripts/copy-mediapipe.mjs` runs before `dev` and `build` and copies the model and the WebAssembly runtime (about 12 MB; a browser fetches only the runtime variant it can run) into `public/mediapipe/`, which is not committed. They are served from our own origin, so a call never depends on a third-party CDN, and are fetched only when blur is first turned on. The package is a classic script that fails in a production Vite build if imported, so it is loaded with a script tag instead. If the package is missing the script only warns.

**Checked.** 11 tests (`tests/camera.test.mjs`); eight deliberate breakages caught (one survived at first because its test stopped the camera before the start had begun; fixed). In a real browser with a **synthetic camera** (a striped test pattern, no person): the blurred output's edge sharpness dropped from 63.4 to 0.1; **20.6 frames per second with the tab hidden**; start-up **15 s the first time** on the dev server (about 12 MB uncompressed plus compiling the runtime) and **1.2 s once cached** (111 ms when turned off and on again, because a spare segmenter is kept). The Vercel build of the PR succeeded, so the copy step works there.

**NOT checked.**
- **A real person in front of a real camera**: whether the cut-out is clean around hair, glasses and hands, and how it looks. The compositing follows MediaPipe's own demo; I could not see it on a person.
- A real call between two browsers; Safari and Firefox; slow laptops; the production first-load time (Vercel compresses, so it should be faster than the dev server, but I did not measure it).
- The two buttons in the real UI (I could not sign in); they compile and follow the pattern of their neighbours.

**Not done.** Android and iOS: those apps use flutter_webrtc's own camera pipeline and would need a native segmentation model (ML Kit or MediaPipe tasks). A blur-strength choice or a replacement image is not built. Only your own camera is processed, but the GPU cost is per sender, so a slow laptop is the case to watch.

## 16. CI and CLAUDE.md (PR #17)

**Why.** Until this PR the only checks on a pull request were Vercel's and Cloudflare's builds, so "all checks green" said nothing about whether a single test had run.

**What.** `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, on Linux runners, as four jobs:
- **Web tests and build**: every `tests/*.test.mjs` except the rules suite (a new test file is picked up without editing the workflow), then `npm run build`.
- **Worker tests**: `npm test` in `workers/`.
- **Firestore rules tests**: the rules suite against the emulator (Java 21). `@firebase/rules-unit-testing` and `firebase-admin` are installed together with `--no-save`, because either one alone removes the other and the suite then fails with `ERR_MODULE_NOT_FOUND`, which looks like a rules failure.
- **Flutter analyze and tests**: Flutter is pinned to 3.44.8 (the version used here). Raise the pin on purpose when upgrading Flutter locally, or an analyzer change becomes a surprise failure on an unrelated PR.

A newer push to the same branch cancels the older run. The macOS iOS build stays manual (`ios.yml`), because macOS runners cost ten times as much.

`CLAUDE.md` at the repo root records the commands, how PRs are done here, and the gotchas from sections 3, 10 and 13 (CRLF files, no Android builds without the keystore, rules not auto-deploying, the one-day cache, presence identity), so a new session starts with them.

**Checked.** The same commands were run locally first: 142 web tests, 18 worker tests, 204 rules tests, a clean `flutter analyze` and 238 Flutter tests. The workflow's first run was the PR's own checks, and all four jobs passed: rules 1m16s, Flutter 2m19s, web 1m32s, worker 15s.

**NOT done.** Nothing enforces it: a red PR can still be merged until the four jobs are marked **required** in the repo's branch protection settings on GitHub (a one-time setting for an admin; I cannot change it from here). The jobs have only ever been seen passing; that a deliberately broken test makes them fail was not tried in CI. Reading failures needs the job log on GitHub (`gh pr checks` shows only pass or fail).
