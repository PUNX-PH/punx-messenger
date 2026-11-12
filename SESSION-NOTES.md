# Session notes — 2026-10-14 to 2026-10-16

What was done, what is still waiting on you, and what was found but not fixed.

## 1. Where things stand (updated 2026-10-16)

PRs #1–#9, #11–#17, #19–#22, #24, #26–#28, #30–#37 are merged (#29 was a small fix to #28) (#10 was closed unmerged; #18, #23 and #25 were notes updates). Up to #13 (`2e15ef0`) I checked the deploy: Vercel and both Cloudflare Workers builds succeeded and https://plexus.punxai.online/ served it (the split bundle and its on-demand parts, the sound files, and the one-day cache on built files, section 13). **#15 (chat re-renders, section 14) and #16 (background blur, section 15) are merged to `main` (`f79b3c5`); their PR checks, including the Vercel build, were green. **Checked on the live site afterwards (2026-10-16, after #21): the login page loads four files and has no console errors, and the bundle contains the blur, chat-error and listener-banner code. It also showed that the blur model files were NOT being deployed: `/mediapipe/...` answered with the app's HTML, so blur would have failed on production with "Couldn't blur your background". Fixed in #22 and confirmed on the live site after it deployed (section 15).** None of these has been tried in the signed-in app. #14 was the notes, and #17 added CI and `CLAUDE.md` (section 16).

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
5. **Try background blur in a real call** (section 15): the button in a voice channel and in a video call, on and off while the camera runs, a real person (is the cut-out clean around hair and glasses?), two browsers, and Safari and Firefox. The first use downloads about 1.9 MB (measured on the live site) and starts in under a second once downloaded.
6. **Check a busy chat in the signed-in web app** (section 14): the typing indicator appears and disappears, edit, delete, react, reply and pin still work, and the scroll position holds when loading older messages.
7. The open items in section 3, and the choice of an SFU provider for 30-person voice (section 4).

### Running the migration script again

The script takes either a service-account key (`GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`) or an `authorized_user` credential file. The second was used here: a file built from the Firebase CLI login (`~/.config/configstore/firebase-tools.json` refresh token, the client id/secret from `node_modules/firebase-tools/lib/api.js`, and `"quota_project_id": "punx-msg"`). Keep such a file outside the repo and OneDrive, and delete it afterwards. Re-running the script is free; a second pass finds nothing.

In the user's own Terminal tab PowerShell blocks `npx`; use `npx.cmd`.

## 2. What shipped (PRs #1–#37)

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

**#19 — chat load errors** (section 17): a conversation that cannot load says so, instead of looking empty.

**#20 — other listener failures** (section 18): one banner says when the people, group, DM, category or emoji feeds stopped updating.

**#21 — GIF favourites per account** (section 19): favourites are no longer one list shared by everyone who signs in on a browser.

**#22 — blur model reaches production** (section 15): the live-site check found the model files were not deployed; the copy now happens inside the Vite config, and CI checks the built site contains them.

**#23 — notes** (the live-site check of the blur model).

**#24 — security headers** (section 20): the site now sends nosniff, no-framing, a referrer policy and a permissions policy.

**#25 — notes** (section 20 and 21).

**#26 — drafts, and a message no longer follows you into another channel** (section 22).

**#27 — unread count in the browser tab title** (section 23).

**#29 — a fix to #28**: the app now cleans up every preference variable, including ones the start-up script set (section 24).

**#37 — apps toolbox** (section 32): a toolbox icon in the chat header that lists the company's other apps, starting with the DTR tracker; visible to developers only for now.

**#36 — chat backgrounds** (section 31): a faint pattern behind the messages, chosen in Appearance & preferences: simple textures, the Punx wordmark (corner, centre, repeating) and one drawing per team.

**#35 — next unread with the keyboard** (section 30): Alt+Shift+Down / Up opens the next unread conversation, from anywhere in the web app.

**#34 — drafts on the phone** (section 29): text typed in a chat and not sent is still there when you come back to that chat.

**#33 — plain-words errors across the Flutter app** (section 28): sending a message, changing a role, creating a group, creating or revoking an invite link, saving group settings and adding an emoji no longer print the raw Firestore error.

**#32 — first findings from the iPhone** (section 27): a DM that cannot be opened now says which step failed and why, and the add-reaction button no longer sits under every message on the phone.

**#31 — iOS ready to build** (section 26): the Firebase config is committed and wired, an unsigned iOS build passes in CI for the first time, and there is a one-command helper for the Mac.

**#30 — quick switcher** (section 25): Ctrl/Cmd+K jumps to any person or channel by typing.

**#28 — appearance and preferences** (section 24): theme, background, accent colour, text size, spacing, font, contrast, reduced motion, clock, send key, message grouping and the tab-title count, saved to the account.

Test counts on `main` at the end: **Flutter 293**, **Node 352** (sound, presence identity, lazy loader, iOS setup, chat identity, camera), Worker 18, Firestore rules 204 (with the caveat in section 3).


## 3. Found but not fixed, and corrections

**A correction to something I reported.** I said the Firestore rules suite had 204 passing tests. Seventeen of those passed for the wrong reason: Firestore was giving up with "the maximum of 1000 expressions to evaluate has been reached", which denies the request, and an assertion that something is denied cannot tell that from a real refusal. So the attacks those tests describe were not actually being evaluated, and a legitimate request (an ordinary member posting in a channel) was one helper call away from being denied in production the same way. The other PC found and fixed it (commit `ff4af1d`: helpers now bind what they read, no rule changes meaning) and made the suite fail loudly on it from now on. Treat the 204 as real only from that commit.

**Open**
- `isGroupAdmin()` ignores membership (a `members:manage` bot can leave an admin in `adminUids` after removing them from `memberUids`).
- **@mention notifications are denied by the rules** (both clients swallow the error). A safe fix needs a collection-group rule keyed on `mentionedUids` plus an index.
- **Presence still costs reads**: Firestore delivers every heartbeat to every client, and that grows with the square of the number online (section 11 fixed the re-rendering, not the reads). The real fix is to move presence out of the `users` collection.
- Listener failures are now reported (sections 17 and 18), except two on purpose: the typing indicator's, and the mention-notification listener, which the rules already deny for everyone (see the @mention item above), so reporting it would put a permanent banner on every screen.
- No Content-Security-Policy yet (the other basic security headers were added, section 20). A CSP needs a signed-in test of sign-in, Firestore, GIFs, voice and blur before it can be enforced.
- GIF favourites are per account but still per browser: they do not follow someone to another device (section 19).
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
- **All of the below run in CI** (`.github/workflows/ci.yml`, section 16), so a PR's checks show them. Web: `vite.config.js` copies the blur model into `public/mediapipe/` (gitignored; needs `npm i` to have run) on every build and dev start. Node tests: `node --test tests/sfx.test.mjs tests/sfx-player.test.mjs tests/users-identity.test.mjs tests/lazy.test.mjs tests/ios-setup.test.mjs tests/chat-identity.test.mjs tests/camera.test.mjs tests/listen-error.test.mjs tests/data-health.test.mjs tests/gif-favorites.test.mjs tests/security-headers.test.mjs tests/drafts.test.mjs tests/unread.test.mjs tests/palettes.test.mjs tests/prefs.test.mjs tests/pref-behaviours.test.mjs tests/quick-switch.test.mjs`.
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

**Not done, in rough order of value (the memoised message list was done afterwards, section 14):** move presence out of `users` (read cost, above); failed listeners (done afterwards, sections 17 and 18); no Content-Security-Policy (the other security headers were added afterwards, section 20; GIF favourites were made per account afterwards, section 19).

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
- **Assets.** `@mediapipe/selfie_segmentation` (Apache-2.0, a devDependency). `scripts/copy-mediapipe.mjs`, called from `vite.config.js` on every build and dev start, copies the model and the WebAssembly runtime (about 12 MB on disk, because both runtime variants are there; a browser fetches only the one it can run, and with compression the first use transfers about 1.9 MB, measured on the live site) into `public/mediapipe/`, which is not committed. They are served from our own origin, so a call never depends on a third-party CDN, and are fetched only when blur is first turned on. The package is a classic script that fails in a production Vite build if imported, so it is loaded with a script tag instead. If the package is missing the script only warns.

**Found on the live site, and fixed (#22).** The copy was first an npm `prebuild` hook. After #16 deployed, `/mediapipe/selfie_segmentation.js` and the model on production answered `200 text/html` (the app's own page, via the single-page-app rewrite) instead of the files, so a blur attempt would have failed with the "Couldn't blur your background" message while every PR check was green. The likely cause is that the host runs `vite build` directly, which never fires an npm `prebuild` hook; I could not read the host's build log or settings to confirm. The copy now runs from `vite.config.js`, so it happens however Vite is started (shown locally: deleting `public/mediapipe` and `dist` and running a bare `npx vite build` produces all nine files in `dist/mediapipe`). CI now builds with `npx vite build` and fails if the model is missing from `dist`. **Confirmed on the live site after #22 deployed:** all seven runtime and model files answer 200 with the right types (JavaScript, `application/wasm`, `application/octet-stream`), no longer HTML; the 5,694,839-byte wasm is byte-for-byte the size of the local copy; and in the live page the real script, model and runtime loaded and a frame went through the segmenter (it returned a mask). First use transferred about 1.9 MB in all (1.6 MB of it the wasm, which compresses well) and initialised in about half a second. That is the model working on production, not a person on a camera.

**Checked.** 11 tests (`tests/camera.test.mjs`); eight deliberate breakages caught (one survived at first because its test stopped the camera before the start had begun; fixed). In a real browser with a **synthetic camera** (a striped test pattern, no person): the blurred output's edge sharpness dropped from 63.4 to 0.1; **20.6 frames per second with the tab hidden**; start-up **15 s the first time** on the dev server (about 12 MB uncompressed plus compiling the runtime) and **1.2 s once cached** (111 ms when turned off and on again, because a spare segmenter is kept). The Vercel build of the PR succeeded, so the copy step works there.

**NOT checked.**
- **A real person in front of a real camera**: whether the cut-out is clean around hair, glasses and hands, and how it looks. The compositing follows MediaPipe's own demo; I could not see it on a person.
- A real call between two browsers; Safari and Firefox; slow laptops; a real person in a real call on production (the model and runtime load there, section 15 above, but no camera was involved).
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

**Also checks the built site.** The web job builds with `npx vite build` and fails if `dist/mediapipe` lacks the blur model (section 15).

**NOT done.** Nothing enforces it: a red PR can still be merged until the four jobs are marked **required** in the repo's branch protection settings on GitHub (a one-time setting for an admin; I cannot change it from here). The jobs have only ever been seen passing; that a deliberately broken test makes them fail was not tried in CI. Reading failures needs the job log on GitHub (`gh pr checks` shows only pass or fail).

## 17. A conversation that cannot load says so (PR #19)

**The problem.** The messages listener had no error handler. A Firestore listener that fails is finished and never delivers again, so a channel you had lost access to, or one whose query needed a missing index, or one opened while the server was unreachable, simply stayed as it was: "This is the start of the conversation" over a channel that might be full of messages. Nothing said anything was wrong.

**The fix.** `listenMessages` takes an error callback; `ChatSurface` shows a panel in place of the list ("Messages couldn't be loaded" plus a reason) and clears the messages, so the previous conversation's messages cannot show under the error. `src/lib/listenError.js` turns the Firestore error code into words: **no access** (`permission-denied`) and **missing index** (`failed-precondition`) say so and offer no retry, because retrying cannot help; **unreachable** (`unavailable`, `deadline-exceeded`, `cancelled`) and anything else offer **Try again**, which subscribes afresh. The raw error text is logged to the console and never shown.

**Checked.** 6 tests (`tests/listen-error.test.mjs`); five deliberate breakages caught. In a browser, the real `ChatSurface` with the data layer replaced by a stub that fails on purpose: the first failure showed "Couldn't reach the server" with Try again; Try again resubscribed; a second failure showed the no-access message with no button. The build passes.

**NOT checked.** Against real Firestore: the local dev setup has no Firebase configuration, so a real `permission-denied` was not produced; the error codes are from Firestore's documentation, not observed. A successful retry after an error was exercised only through the stub. Not done here (the other listeners are section 18): the message *composer* is still shown under the error panel and its sends would fail on their own.

## 18. The other listeners say so too (PR #20)

**The problem.** Section 17 fixed the chat. Nine other Firestore listeners had no error handler either: the people list (two copies), the DM list, your groups, one group, a group's channel categories, custom emojis, the typing indicator and the mention notifications. When one fails it is finished and the screen it fed just stays as it was: a group list that is empty, a DM list that never fills, people who never show as online, with nothing to say so.

**The fix.** One shared record and one banner instead of nine screens:
- `src/lib/dataHealth.js`: a listener reports its failure here, and its next successful snapshot clears it. `onSnapshot(q, ...watched('your groups', snap => { ... }))` wires both callbacks in one line; feeds that exist per group take a key (`group:<id>`) so two failures are not merged.
- `src/components/DataProblemsBanner.jsx`, mounted once beside the routes in `App.jsx` (so it outlives sign-in and sign-out): "Couldn't keep your groups and people up to date, so what you see may be out of date." with **Reload** (a failed listener is finished for good, so reloading is the retry) and a dismiss that hides exactly those problems (a new one shows again). It adds "You may no longer have access to some of it" when any failure was `permission-denied`. It forgets everything when the signed-in person changes, and is hidden until there is a profile.
- Wired into `listenUsers`, `listenAllUsers` (what the app really uses), `listenMyDmConvos`, `listenMyGroups`, `listenGroup`, `listenCategories` and `listenEmojis`.

**Left alone on purpose.** The mention-notification listener: the notes (section 3) already record that the rules deny it for everyone, so reporting it would show every user a banner that never goes away; it still logs to the console. The typing indicator's listener: not worth a banner. The listeners that already had error callbacks (calls, voice, bots, invites, all-groups, channels) keep their own handling.

**Checked.** 10 tests (`tests/data-health.test.mjs`); ten deliberate breakages caught. In a browser, the real banner driven through: nothing wrong shows nothing; one feed; two feeds with one denied (adds the access hint); Dismiss hides it; a new failure shows it again; all recovered clears it; the Reload button is present. The build passes.

**NOT checked.** Against real Firestore (no Firebase configuration in the local setup), so no real listener has been seen to fail and report; the sign-in/sign-out clearing was reasoned, not exercised; and the banner has not been seen in the signed-in app. It could show a banner for a failure that was previously invisible and harmless: if so, that is the point, but watch for one that appears for everyone (that would be a rules problem like the mention one, to be fixed in the rules, not hidden).

## 19. GIF favourites belong to an account (PR #21)

**The problem.** Favourite GIFs were one list in the browser's `localStorage`, under a single key. Anyone who signed in on a shared computer saw, and could add to or remove from, the previous person's favourites.

**The fix.** `src/lib/gifFavorites.js` keys the list by the signed-in account (`punx.gifFavorites.<uid>`); `GifPanel` passes the account in. **The old shared list is not thrown away**: the first account that opens its favourites after the upgrade adopts it, and the shared copy is removed so nobody else inherits it. With two people on one browser that means the first to look gets it, which is a guess; it is better than deleting it. The read path is also tougher: a damaged or hand-edited value, or entries without an id, give an empty or trimmed list instead of a crash in the GIF panel, and a full or blocked `localStorage` still shows the favourite for the session.

**Checked.** 13 tests (`tests/gif-favorites.test.mjs`); the mutation run killed every non-equivalent change (one survivor, dropping the `Array.isArray` check, is equivalent: the surrounding `try/catch` already turns a non-array into an empty list; and the run found a real gap, an old list being adopted while nobody is signed in, which got its own test). In a browser, the real `GifPanel` with the account and the network stubbed: with an old shared list in storage, the first account saw it in Favorites, a second account on the same browser saw none, and the first still had it afterwards.

**NOT done.** Favourites are still per browser: they do not follow someone to another device or browser. Syncing them (a `users/{uid}` subcollection) needs a Firestore rules change, which is a deployment decision, so it was not started. Not checked in the signed-in app, and not with real Klipy results (the panel's trending and search were stubbed out; only the Favorites tab was exercised).

## 20. Basic security headers (PR #24)

**What was missing.** The live site sent only `Strict-Transport-Security`. It sent no protection against browsers guessing file types, against the app being framed by another site, or against leaking the page address to other sites, and it did not say which powerful browser features the app may use.

**What it sends now, on every path** (`vercel.json`, and the same set in `public/_headers` for Cloudflare):
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`: nothing needs to frame the app (the Google sign-in opens a popup, not a frame).
- `Referrer-Policy: strict-origin-when-cross-origin`: **invite links carry a secret in the path** (`/invite/<token>`), so other sites must only ever be told the origin, never the path. This is the browser default, now stated explicitly so it cannot change under us.
- `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()`: **camera, microphone and screen share stay allowed for this site**, because voice, video calls, background blur and screen share need them; taking `(self)` off any of the three would silently break calling. Location, payment and USB are never used, so they are off.

**Left out on purpose.** A **Content-Security-Policy**: it has to name every place the app talks to or loads from (Firebase and Google sign-in, Firestore, the Workers, GIFs, custom emojis, profile photos, fonts, the blur model's WebAssembly and its worker), and a mistake blocks sign-in or calling. It needs a signed-in test before it is enforced, ideally first in report-only mode. A **Cross-Origin-Opener-Policy**: the Google sign-in popup would break.

**Checked.** 8 tests (`tests/security-headers.test.mjs`) pin the four headers, that camera, microphone and screen capture stay `(self)`, that no Opener policy is set, that the one-day cache rule on `/assets/` is untouched and not overridden (the all-paths rule must not set `Cache-Control`, or `index.html` would stop revalidating), that the single-page-app rewrite is unchanged, and that the Cloudflare file sends exactly what Vercel does. Run through Vercel's own routing library, the config gives every path the four headers and only `/assets/` the cache header. **Checked on the live site after it deployed (2026-11-09):** the root page, an `/invite/...` page, a built file, a blur model file and a sound all carry the four headers, and only `/assets/` carries the one-day `Cache-Control` (the others still revalidate). In a real browser the login page loads with no console errors, and the page's own policy reports camera, microphone, screen capture, fullscreen and autoplay as allowed and location, payment and USB as blocked.

**NOT checked.** In the signed-in app: that calling, voice, screen share and sign-in still work with the policy in place (the policy allows them and the browser agrees, but they have not been tried). The PR's own checks do not exercise the headers.

## 21. Vercel stopped deploying, and the repository is now public (2026-11-09)

**What happened.** PR #24's Vercel check failed with "Cannot deploy from a private GitHub organization repository on the Hobby plan", although every PR up to #23 had deployed. The repository's last-updated date was 2026-10-22, so a change to the repository or to Vercel's rules around then is possible, but the cause was not confirmed. Production was unaffected at the time (it was still serving the build from #22).

**What was done.** The repository was set to **public** (by the user; it was private before). Pushing a new commit then deployed normally, and #24 went live. Nothing else changed. Upgrading the Vercel plan or moving the repository would also have worked; public was the user's choice.

**Before it was relied on as public, the history was scanned** (all 195 commits): no private keys, no service-account files, no keystore or `key.properties`, and no tokens or secrets matching common patterns. What is public now and was checked: the Firebase web and Android API keys (public identifiers by design; the Firestore rules, now also public, are what protect the data), `.env.example` (blank Firebase values, the sign-in domain `punx.ai`, and one super-admin email address), the rules, the Workers' code and the docs. Not covered by that scan: anything that never reached git (the release keystore and `key.properties` stay on the other PC and are ignored), and the Worker secrets set in Cloudflare, which are not in the repository.

**Worth knowing now that it is public.** Anyone can read the code, the rules and the notes in this file, including the lists of open weaknesses (sections 3 and 20). The rules are the real protection, and an open item such as the missing Content-Security-Policy is now visible to outsiders; that is a reason to work it down, not to hide it. Pull requests from outside the organisation are possible now, so CI can run on them: review any change to the workflow from someone you don't know before letting it run. If the repository goes back to private, the Hobby-plan block returns.

## 22. A half-typed message no longer follows you into another channel (PR #26)

**The bug.** The message box and the chat around it stay mounted while you move between channels and DMs (neither the route nor the chat component is keyed by conversation). So whatever was typed in one channel was still in the box in the next, and **pressing send posted it there**. A "replying to" chosen in one channel was still pending in the next, and the search and pinned panels stayed open. Reproduced on the real chat component first: text typed for channel A, switch to B, send: it was posted to B.

**The fix, and a feature that comes with it.** Drafts are kept per conversation (`src/lib/drafts.js`): saved as you type, put back when you return to that conversation, and an empty box in one you have not typed in. They live in `sessionStorage` (so a reload keeps them, closing the tab drops them), are keyed by account as well as conversation, are capped (the 50 most recently touched, 20,000 characters each), are written after a short pause in typing and when the page is hidden, and are **wiped on sign-out** so a shared computer does not show one person's draft to the next. Also: the chat now drops the pending reply and closes search and pinned when the conversation changes; the "typing…" marker is cleared at once in the conversation you left (it used to wait for a five-second timer, and a send made in the new conversation within that time cleared the new conversation's marker instead of the old one's); a slow send finishing after you moved on no longer empties the box in the new conversation; and the box's height follows its content whenever the text changes, so a restored multi-line draft is the right size and a box emptied by moving away shrinks.

**Checked.** 18 tests (`tests/drafts.test.mjs`); the mutation run killed every change that matters (one survivor is equivalent, a guard whose absence returns the same empty string; it also found a real gap, that a cleared draft must stay cleared after a reload or a sent message would reappear, which got its own test). In a browser, on the real chat and message-box components with only the database and sign-in stubbed: B starts empty with no leftover reply; A's draft comes back, its reply does not; a message sent from B goes only to B with only B's text; sending clears that draft and keeps the others; a slow send finishing after switching to C does not wipe what was typed in C; a reload restores the draft; the typing marker is cleared for A when switching to B; the box height shrinks and regrows correctly.

**NOT checked.** In the signed-in app against real Firestore, and in the real router (the harness re-renders the chat with a new path, which is what the route does, but it is not the router). Attachments and half-picked @mentions are deliberately not kept as drafts: switching conversation drops them. Not done: drafts do not follow someone to another browser or device.

## 23. Unread count in the browser tab title (PR #27)

**What.** The tab's title shows how many conversations have something new: "(3) Punx Messenger", up to "(99+)", and plain "Punx Messenger" when there is nothing. It is visible from another tab, in the window list and in the taskbar. It counts conversations (DMs and channels), not messages, because all a conversation records is when its last message arrived. Muted groups do not count (they do not badge in the sidebar either). A DM whose last message is your own, or that was only opened and never written in, does not count. The conversation you are looking at is left out.

**The change that makes it useful.** The chat used to mark the open conversation as read whenever it was open, **even in a hidden tab**, so a message arriving in the channel you had left open in the background was "read" the instant it landed: no unread dot, no count. Now it is marked read only while the page is visible *and* focused (the same test the desktop notifications use, `src/lib/usePageActive.js`), and as soon as you come back. **This changes when unread dots clear:** with Punx visible on a second monitor and the keyboard elsewhere, messages stay unread until you click into it. And a switch back to a tab where nothing is new no longer writes to the database (`needsMarkRead`: it writes only when the newest message is newer than the last read), so tabbing back does not wake every other client's listener.

**How.** `src/lib/unread.js` holds the counting and the title text with no Firebase in it (`isUnread`, `pathToReadKey` and `dmConvoId` moved there from `db.js`, which re-exports them). `src/lib/useUnreadCount.js` listens for your DMs, groups and channels the same way the side rail does (identical Firestore queries are shared by the client, so no extra reads); `src/components/TabTitleUnread.jsx` writes the title and restores it on sign-out.

**Checked.** 13 tests (`tests/unread.test.mjs`); the mutation run killed every change tried. In a browser with the data layer stubbed, on the real hook, component and chat: the title reads "(3)" for one DM and two channels; the DM being read is left out only while the tab is active, and counts while it is hidden; a channel read elsewhere drops out; a muted group drops out; my own DM message drops out. A hidden tab marks nothing read and marks the conversation as soon as the tab becomes active; with a last-read time already past the newest message, switching back writes nothing, and with something newer or never read it writes once.

**NOT checked.** The signed-in app against real Firestore. **Channels do not record who wrote last**, so a channel message you sent from another device counts as unread here until you open it (the sidebar behaves the same way). Not done: a favicon badge, and the Android app (the switch to turn the count off is in the preferences, section 24), which does not do any of this.

## 24. Appearance and preferences (PR #28)

**What.** "Appearance & preferences" in the user menu (the gear in the bottom-left) opens one screen of personal choices. Every change applies the moment it is made (the whole app behind the dialog changes with it), there is no Save button, and a small live preview of a conversation sits at the top. Reset to defaults is at the bottom.
- **Theme:** Auto (follows the device, live), Light, Dark.
- **Background:** eight (Slate, Midnight, Ocean, Forest, Berry, Sunset, Grape, Charcoal), each with a dark and a light shade.
- **Accent colour:** the original blue, nine presets (Ember, Amber, Green, Teal, Sky, Blue, Violet, Pink, Rose) and a custom colour picker.
- **Text size:** Small, Default, Large, Extra large. **Spacing:** Comfortable or Compact. **Font:** Inter (default), System, or Readable (Atkinson Hyperlegible, fetched from Google Fonts only if chosen).
- **Higher contrast** and **Reduce motion** (the second also stops smooth scrolling in the message list; it is on already if the device asks for less motion).
- **Messages:** clock (automatic, 12-hour, 24-hour), send with Enter or Ctrl/Cmd+Enter (plain Enter is then a new line), and how close in time messages from one person are grouped under one name (never, 2, 5 or 15 minutes).
- **Alerts:** the unread count in the tab title on or off, sound effects on or off (this one stays on this device, as before), and the desktop-notification permission.
The defaults change nothing: the original background and blue accent add no variables at all, so someone who never opens it sees exactly what the app always looked like.

**Colour can never make the app unreadable (the part worth knowing).** `src/lib/palettes.js` works every colour out from the original palette. Each background keeps the *brightness* of every original surface (equal lightness is not equal brightness: green at the same lightness is far brighter than blue), so text keeps its original contrast on it, within 2% (colour channels are whole numbers). The light theme's main surface is nudged off pure white to carry the tint, which makes dark text on it very slightly less contrasty (about 17.5:1 instead of 18:1). An accent is darkened until white text on it is at least 4.5:1 (so a yellow or amber becomes a deeper one), its hover shade is darker still, and the accent used as text is lightened (dark theme) or darkened (light theme) until it is at least 4.5:1 on every surface. Higher contrast takes the quiet text to at least 7:1. `tests/palettes.test.mjs` checks all of it for every background in both themes with every accent, and with 400 arbitrary colours plus the awkward extremes (pure yellow, white, black).

**Where it is kept, and how it follows you.** On the device (`localStorage`) and in the account, as a `prefs` field on the person's own `users/{uid}` document. **The Firestore rules already allow that** (a person may update their own document except role, email, uid and a few protected fields), so no rules change and no deploy was needed. The copy changed last wins (each has an `updatedAt`); everything read from the device or the account goes through one validator that accepts only values on the lists, so a stale, hand-edited or newer-version copy cannot break the page or smuggle anything in. A different person signing in on the same browser starts from the defaults, not the last person's look (`punx.prefsOwner`). On first sign-in after this ships, choices already made on the device (including the old light/dark switch) are kept and saved to the account. The account write waits for a pause (a colour picker fires dozens of changes), and the screen says whether it is saving, saved, or saved on this device only.

**No flash of the wrong colours.** The page's colours and settings are worked out once and stored on the device (`punx.prefsCss`); a small script in `index.html` applies them before the first paint. It is separate code (nothing can be imported that early), so `tests/prefs.test.mjs` runs that very script and holds it to the same result as the app's own for several sets of choices, with the device light and dark.

**Checked.** 84 tests across `tests/palettes.test.mjs`, `tests/prefs.test.mjs` and `tests/pref-behaviours.test.mjs`. A mutation run of 44 deliberate breakages across the colour maths, palettes, validation, store and the three behaviours caught all but five, four of which are equivalent (a guard whose absence behaves the same; `hourCycle: 'h23'` against `hour12: false`, which this engine renders identically); the fifth was a real gap (going back to the default text size must remove the size), now tested. In a browser, on the real dialog and store: it renders in the app's own style; choosing Ocean, Ember, Light, Large and Compact changes the page at once and is stored on the device; a reload keeps the look; the live preview follows; Compact really tightens the message spacing (the first version did not: Tailwind's own spacing rule out-ranked mine, found by measuring, and fixed); text size scales the layout; higher contrast and reduce motion switch on and off and leave nothing behind; the status line shows saving, saved and error; "Auto" applies the device's current setting.

**Checked on the live site after it deployed (2026-11-09).** The page carries the start-up script and the bundle the preferences code; the dialog's own file (`PreferencesModal-*.js`) is served as JavaScript; the login page loads with no console errors; and a snapshot stored on the production origin was applied by the page's own script before the app ran (the accent colour was set on reload). That check also found a real edge case: when the app started with no matching saved choices it removed the text size and spacing but **left the accent colour behind**, because it only removed variables it had set itself, not ones the start-up script had. It needs mismatched storage to trigger (the two are always written together, so it does not happen in normal use), but it is fixed: the app now cleans up a fixed list of every variable the preferences can set (`MANAGED_VARS` in `src/lib/prefs.js`), a test checks that the list covers everything the palettes and accents produce, and another that variables the start-up script set are removed too.

**NOT checked.**
- **Against real Firestore and in the signed-in app.** The write to `users/{uid}`, the adoption of the account's copy at sign-in, and the "different person on this browser" reset are covered by tests of the store and by reasoning from the rules, not exercised with a real account.
- **Auto changing while the app is open.** The code that follows the device live is unit-tested with a stand-in; in the test browser even a plain listener of my own never received the device's change, so the real event was not observed.
- **Small phones at Extra large text**, and every other screen at every combination. The preview and dialog were looked at; the whole app was not walked through at each size, background and accent.
- **The Readable font** was not loaded and looked at (it needs the network).
- **Compact** tightens the message list and the sidebars only.
- **Android and iOS do not read these**: the apps keep their own theme setting. The `prefs` field is a new, ignored field on the user document as far as they are concerned.
- The account copy is readable by other signed-in people (the user directory is), which is fine for appearance choices but is why nothing sensitive may ever be added to it.

## 25. Quick switcher: Ctrl/Cmd+K (PR #30)

**What.** Press Ctrl+K (Cmd+K on a Mac) anywhere, even while typing a message, and a small box opens: type part of a name and press Enter to go there. It lists your notes, every teammate, every channel (with the group it is in, so two "general" channels can be told apart) and voice rooms. Unread conversations come first and carry a dot; with nothing typed it shows what is unread, then what was most recently active. Arrow keys move, Enter opens, Escape closes; Ctrl+K again closes it. Typing `#` narrows to channels, `@` to people. It is also in the user menu ("Jump to a conversation"), for anyone without a keyboard handy.

**How it ranks.** `src/lib/quickSwitch.js` (pure, tested). Every word typed must match. A name that starts with the word beats a word inside the name, which beats the middle of a word; then the group's name or a person's email; then letters in order starting at the beginning of a word ("mkt" finds "marketing"). Case and accents are ignored ("zoe" finds Zoë). Unread gets a lift, but a much better name still beats a weaker unread one. The first version let letters be picked from anywhere in a name, so "ana re" found "brand-assets"; matching now has to start at the beginning of a word.

**Shared plumbing.** The listeners for your DMs, groups and channels moved into one hook (`src/lib/useConversationData.js`) used by both this and the tab-title counter (identical Firestore queries are shared by the client, so no extra reads). The box and its file load on first use (about 1.6 KB gzipped).

**Checked.** 20 tests (`tests/quick-switch.test.mjs`); a mutation run of 22 breakages caught all that matter (two reported "missing" only because of how the mutation text was escaped; one survivor, that a name starting with the word must outrank a word inside it even against the alphabet, was a real gap and is now tested). In a browser, on the real component with the data stubbed: Ctrl+K opens it with the box focused; "mkt", "zoe" (accent), "general" (two groups) and "#" / "@" rank and filter as designed; ArrowDown moves the highlight; Enter navigates and closes; "qqqq" says nothing matches; Ctrl+K again closes. A cosmetic bug was found there ("My Notes" read "in Private to you") and fixed.

**NOT checked.** In the signed-in app against real data. The shortcut was sent as a synthetic key event, not typed on a real keyboard, and Cmd+K on a Mac was not tried. In some browsers Ctrl+K belongs to the browser (Firefox focuses its search bar); the page takes it first, but if a browser or extension insists, the menu entry is the way in. Not done: highlighting the matched letters, remembering recent choices, and Alt+Up/Down to step through unread conversations.

## 26. iOS: ready to build, and it compiles (PR #31)

**Where it stands.** Section 12 left the iOS app prepared but with one blocking gap (no Firebase config) and never compiled. Both are now closed. The only thing left before it runs on an iPhone is a person with a Mac: pick the signing team in Xcode, plug in the phone, run the device checklist in `docs/IOS.md`.

**The Firebase config.** The Firebase CLI login works again on this machine (it had expired). `firebase apps:list` showed an iOS app, "Plexus" (`1:781531419503:ios:d7c24f1f998a09dc13ce9a`), already registered in `punx-msg`, so nothing was created. Its `GoogleService-Info.plist` was fetched (read-only) and checked: bundle id `com.punx.plexus`, project `punx-msg`, and the Google sign-in client present. It is committed at `android_app/ios/Runner/`, and `node scripts/ios-setup.mjs --apply` registered Google's sign-in URL scheme in `Info.plist` and added the plist to the Runner target's resources. The readiness check is **15 ok, 0 blocking, 1 warning (the signing team)**. The plist holds identifiers Firebase treats as public, like the Android `google-services.json` already committed; the Firestore rules protect the data. The repository is public now, so it is good practice to restrict the iOS API key to the bundle id in the Google Cloud console. I could not check whether that has been done.

**It compiles.** The "Build iOS (macOS runner)" workflow was run by hand on the pushed branch (compile-only, unsigned): readiness, `flutter analyze` and `flutter build ios --release --no-codesign` all succeeded on a macOS runner in about 11 minutes, producing a 21 MB `Runner.app` (run 42590203058). That proves the Xcode project, CocoaPods and every plugin, `flutter_webrtc` (the likeliest trouble) included, build for a device. Because the repository is public, macOS runner minutes are free, so it can be re-run any time. It does **not** prove the app runs.

**For the Mac.** `bash scripts/ios-first-build.sh` does the machine check, the project check, `flutter pub get`, `pod install` and the unsigned compile, stops at the first problem with a plain message, refuses politely on anything that is not a Mac, and ends by listing what only a person can do. `.gitattributes` keeps `*.sh` on LF.

**A test problem I caused, and fixed.** Committing the wired project broke 9 of the 30 iOS-setup tests, which expected the real project to be unwired; I had chained the commit after the test run and did not stop on the failure. The tests now start from committed copies of the two files as they were before the wiring (`tests/fixtures/ios`), and a new test fails if the real files ever differ from "fixture plus the script's two edits", so the fixtures cannot silently go stale (proved by tampering with the real `Info.plist`). Also new: the committed project is ready apart from signing, and `--apply` on it changes nothing. 33 tests.

**NOT checked.** Anything at runtime: sign-in, the voice and call audio, notifications, the sound effects (section 9's iOS guards are reasoned, not heard), photo attach, background audio, and every line of the device checklist. The signed build and TestFlight (they need an Apple team and signing secrets). Sign in with Apple is still undecided (section 12). There is still no push notification on any platform. The web-only features of this session (preferences, the quick switcher, the tab-title count, drafts) are not in the Flutter app.

## 27. First findings from the iPhone (PR #32)

The first build went to TestFlight and was tried on a phone. Two things came back as screenshots. Both are in the Flutter app, which is shared with Android, so neither is iOS-specific.

**1. A DM that would not open: `[cloud_firestore/permission-denied]` on a blank "Direct Message" screen. Cause NOT determined.** The screen is the error branch of the code that sets up a conversation, which makes three separate Firestore calls: read the other person's profile, look for the conversation document, create it if it is missing. The raw error did not say which one. What I did and found:
- Replayed the Flutter app's exact calls (the same document shapes) against the real `firestore.rules` in the emulator, in seven situations. They all succeed for an ordinary employee opening a new or an existing DM, for a guest, and for ids that differ in case. They fail in exactly two: a **deactivated** account (the first read, the other person's profile, is refused) and a conversation document **already sitting at that pair's id that does not list you** (the "squatted" conversation the rules comment describes: reading it is refused). (The scratch test was not kept.)
- The app already signs a removed account out with an explanation, so the deactivated case is the less likely. The rules file has not changed in behaviour since it was deployed (the last change only removed two unused helpers), so a deployed-rules mismatch is unlikely but was not checked directly: Firebase offers no command to read the deployed rules.
- **What changed:** the error screen now says which step failed, what that usually means in plain words, the code, and (for the conversation steps) the document id, and has a **Try again** button (`lib/services/dm_open_error.dart`; 9 tests, 10 of 10 deliberate breakages caught). **The next screenshot of this screen will name the step.** If it says "looking for the conversation" the fix is data: an admin looks at `dms/<id>` in the Firebase console (members should be the two people) and fixes or deletes it.
- **Needed from whoever saw it:** which Google account was signed in on the iPhone, which teammate was tapped, whether other teammates open fine, and whether the same pair opens on the web. I deliberately did not read production DM documents (their previews hold message text).

**2. The add-reaction button under every message.** In the channel screenshot each message had a boxed smiley permanently drawn beneath it. The web shows that button only once a message has reactions (otherwise on hover); a phone has no hover, so it was drawn always. `ReactionChips` now draws nothing for a message with no reactions (the long-press menu already offers "React"), and the button appears next to the chips once there is one (4 widget tests; two failed before the change). This is the one thing I could see in that screenshot; the rest of the screen was cropped, so **if something else looks wrong on the phone, send a full-screen shot**.

**Checked.** Flutter analyzer clean; all 251 Flutter tests pass. **NOT checked:** on a device (nothing here can run the app on a phone), and the cause of the permission error, as above.

## 28. Plain-words errors across the Flutter app (PR #33)

**Why.** A second screenshot from the iPhone showed the raw error again, cropped, with no way to tell which screen or action it came from: `[cloud_firestore/permission-denied] The caller does not have permission to execute the specified operation.` Section 27 fixed that for opening a DM only. Six more places in the Flutter app printed `'$e'` straight to the person; they now go through one function.

**What.** `lib/services/user_error.dart`, `describeError(error, action: ...)`: a sentence that names what they were trying to do and says what is likely wrong, with the short code last for whoever they report it to. For example, a refused send now reads "You don't have permission to send that message. If that is unexpected, your access may have changed: sign out and back in, or ask an admin. (permission-denied)". Signed out, no connection (unavailable, deadline-exceeded, network-request-failed, a socket error, a timeout), deleted underneath you, already exists and too many requests each have their own sentence; any other code is "Couldn't <action>." plus the code. The app's own readable messages (a `StateError`, an `Exception('...')`, a `FormatException`, an `ArgumentError` with text) are shown as written, without Dart's "Bad state:" prefix. Anything else (a platform error, a bug, even a `RangeError`) is just "Couldn't <action>." and never raw.

**Where it is used (and the action it names):** the message box ("send that message"), the admin panel's role change ("change that person's role"), create group ("create the group"), the invite screen ("create the invite link", "revoke that link"), group settings ("save that change", which covers the name, avatar and banner), and the emoji upload snackbar ("add that emoji"). **Not changed:** the DM screen's own version from section 27, which knows more (the step and the conversation id); any message a screen writes itself ("Give the group a name.").

**A portability point.** The first version recognised a network failure with `SocketException` from `dart:io`; nothing else in the app imports that library and the project has a `web/` target, where it does not exist. It is now recognised by type name, so no import is needed.

**Checked.** 14 tests for the function and 3 widget tests on the real message box (a refused send shows the plain words and not the raw text; no connection says so and keeps the typed text so it can be retried; the app's own message is shown without "Bad state"). All 18 deliberate breakages of the function, and putting the raw error back in the composer, were caught. Flutter analyzer clean; all 268 Flutter tests pass. **NOT checked:** the five other screens individually (they use the same function; only the message box has a widget test), and on a device.

## 29. Drafts on the phone (PR #34)

**Why.** The web app has kept unsent text per conversation since an earlier PR (`src/lib/drafts.js`); the phone had not. Backing out of a chat, or iOS reclaiming the app while it was in the background, threw away whatever was half-typed. On a phone, where each chat is its own screen, that happens all the time.

**What.** `lib/services/draft_store.dart` (`DraftStore`), same rules as the web: the 50 most recently touched drafts are kept, each at most 20,000 characters; an empty or whitespace-only box is no draft; written to storage 400 ms after typing stops and at once when the app leaves the foreground. Keys are `<uid>:<conversation path>`, so two accounts on one phone never see each other's text. Loaded in `main()` before the first frame (so a chat opened from a notification already finds its draft) and handed in through `draftStoreProvider`; with no override it falls back to an in-memory store, so a widget shown alone in a test is never a crash. `Composer` takes `drafts` and `draftKey` (both optional; both null is exactly the old behaviour), puts the saved text back with the cursor at the end *before* it starts listening (restoring is not typing, so it sends no typing indicator), and saves on every change to the box, including a picked @mention or an emoji. A successful send empties the box, which clears the draft; a failed send keeps both. `draftCleanerProvider` wipes everything when the signed-in account goes from someone to nobody, so the next person on a shared phone does not find the last one's half-written messages.

**Checked.** 25 new tests: the store (isolation by key, whitespace, the 50 cap with recency, the 20,000 cap, survives a restart, a sent message does not come back after a restart, wipe, writes wait for a pause, damaged storage), the real message box (restored after the chat is closed and reopened, another conversation and another account start empty, sent clears, failed send keeps, clearing clears, no store means old behaviour, cursor at the end, a cursor move is not an edit) and the sign-out wipe. 13 deliberate breakages: 10 caught at once; 3 survived, of which 2 were real gaps in the tests (clearing a draft not being written to storage was hidden by a `flush()` in the test; a cursor move counted as an edit), fixed and now caught; the third, dropping the "was signed in before" half of the wipe condition, is an equivalent change, because the listener only fires when the signed-in user changes. Flutter analyzer clean; all 293 Flutter tests pass.

**NOT checked.** On a device (needs a new TestFlight / Android build: nothing here reaches the phone until then). The real `shared_preferences` plugin (tests use its in-memory test double), and the app-goes-to-background flush on a real phone (the lifecycle hook is not exercised by a test). Drafts are not synced between devices and not shared with the web app's drafts (by design: they are per device).

## 30. Next unread with the keyboard (PR #35)

**Why.** Working through what came in while you were elsewhere meant finding each bold name in the sidebar, or opening the switcher (Ctrl+K) each time. Discord's Alt+Shift+Up/Down does it in one key.

**What.** Alt+Shift+Down opens the conversation that has waited longest for you; Alt+Shift+Up the newest one. The conversation on screen is never chosen, so pressing again moves on to the next. It works from inside a text box (Alt+Shift+arrow means nothing useful there), is ignored while an input method is composing, and does nothing when nothing is unread. "Unread" is exactly what the switcher and the sidebar already use (`buildTargets`): a muted group does not count, and a DM whose last message is your own does not. `pickUnread` and `unreadKeyDirection` in `src/lib/quickSwitch.js` are pure; `src/components/UnreadHotkeys.jsx` is the listener (mounted in `App.jsx` beside the tab-title counter, which shares its data, so no new reads). The switcher's footer mentions the shortcut (Option on a Mac).

**Checked.** 7 new tests; 11 deliberate breakages (swapped direction, not skipping the current conversation, not filtering to unread, no tie-break, wrong order, each modifier key's condition, composing, the empty case) were all caught. The real component with stubbed data in the browser: from inside a text box, Down opened the DM that had waited longest, Down again the channel, Up went back, a plain Down arrow did nothing, and the typed text was untouched. All 324 Node tests pass and the build is clean.

**NOT checked.** Signed in against the real app (the harness stubbed the data). A Mac keyboard: macOS Option+Shift+arrow normally extends a text selection, and the shortcut takes that over everywhere, including in the message box. Whether Alt+Shift+arrow collides with a browser, OS or screen-reader shortcut for anyone. No setting to turn it off.

## 31. Chat backgrounds (PR #36)

**Why.** A request for personal backgrounds "similar to Discord" that stay minimalist, including the Punx logo in the corner and designs for the company's teams. Discord's version is a paid cosmetics shop with illustrated art; this is the free, minimal part of that idea: one new preference, "Chat background". Frames around avatars and nameplates (the other Discord items) were discussed and are **not** built: others would have to see them, which means a field on the public user profile and every avatar drawn differently.

**What.** Appearance & preferences has a new "Chat background" section: 17 choices in three groups, and a Subtle / Normal / Strong control. **Simple:** dots, grid, ruled, diagonal, crosses, contours. **Punx:** the wordmark in the bottom-right corner (above the message box), in the centre, or repeated. **Teams:** creatives (shapes), 2D artists (pen curves with handles), 3D artists (cubes), AI Labs (a node network), game dev (pixel hearts, diamonds, pads), HR (people, a speech bubble, hearts), engineering (`</>`, `{ }`, a prompt). The default is **None**, so nobody's app changes until they choose one.

**How it works.**
- Each pattern is a black-on-transparent SVG used as a CSS **mask** on a `::before` of the message area (`.chat-pattern`, on both the full and the empty chat in `MessageList.jsx`). The visible colour is `rgb(var(--ink) / alpha)`, the page's own text colour, so one drawing suits every theme and background and nothing is hard-coded. Opacity: Subtle 0.045, Normal 0.07, Strong 0.12; a single large mark is multiplied by 1.25.
- The drawings live in `src/lib/chatPatterns.js` (one source of truth). `src/patterns.css` is **generated** from it by `node scripts/gen-patterns.mjs` and committed (the page needs it before first paint). A test fails if they differ, so after editing a pattern run the script.
- It is a normal preference (`pattern`, `patternStrength` in `prefs.js`): validated by the same single door, stored on the device and in `users/{uid}.prefs`, newest wins, and applied before first paint by the script in `index.html` as two attributes on `<html>` (`data-pattern`, `data-pattern-strength`). Only names from the list ever reach a selector. Rules did not need to change (users already update their own document).
- **Higher contrast switches the pattern off** (the choice is kept and comes back when it is turned off), because a pattern behind the text would lower the contrast that setting exists to raise. The dialog says so.
- The Punx mark was redrawn as a vector from the logo (`public/logo-punx.png`): measured at 39 px tall, 9 px strokes, wide gaps. An earlier draft faded each letter shape separately, so overlapping strokes (N, X, the P) stacked into bright patches; the mark is now one set of solid shapes faded as a whole.

**Checked.** 20 new tests (preference validation incl. hostile values, the snapshot, the attributes and their removal, high contrast, the start-up script and the app putting the same things on the page for three new samples, each drawing well formed / colourless / inside its tile, the generated stylesheet identical to its source, a rule for every pattern, `pointer-events: none` and sitting behind the text, both message-list branches carrying the class, the stylesheet being loaded, the logo's proportions, labels). 22 deliberate breakages, 21 caught at once; the survivor (a stray space in a label) was guarded with a test. In a real browser, with the real dialog, the real preference store and the real stylesheet (stubbed: only notifications): all 17 render in the chat in dark, several in light; a real click on a tile applied it; Strong set opacity 0.12; Higher contrast removed the pattern and showed the note; turning it off brought it back; None removed the strength control. All 344 Node tests and the build pass.

**NOT checked.** Signed in against the real app and the real Firestore save of the new fields. Safari and Firefox (CSS masks are supported in current versions, with the `-webkit-` form included, but only Chromium was looked at). Phone-sized screens in the real app (only a 347 px wide page was seen, and the corner mark looked right there). Whether the patterns look right to the teams they are for: they are my drawings, not a designer's. Performance on a very long chat (a mask on one element, repainted only when the theme changes, but not measured). The Flutter app has no backgrounds yet. Not done: a background for the sidebars, avatar frames, nameplates, any per-group default.

## 32. Apps toolbox (PR #37)

**Why.** The messenger is meant to be the hub, and more company apps are coming, starting with the DTR tracker (https://dtr.punxai.online/). A toolbox icon in the chat header gives them one place to be reached from.

**What.** A toolbox icon in every chat header (channels, DMs and notes: it is in `ChatSurface`), between the pinned-messages icon and the per-screen buttons (the members icon in a channel, the call buttons in a DM). It opens a small menu; each entry opens its app in a new tab (`target="_blank"`, `rel="noopener noreferrer"`). Escape and a click outside close it. Today the list has one entry, "DTR tracker".

**Visible to developers only, for now.** `APPS_VISIBLE_TO = ['developer']` in `src/lib/apps.js` (the `developer` role of docs/ROLES.md). Super admins, admins, employees and guests do not see the icon, and neither does anyone before their profile has loaded. To open it up, add roles to that list. **This only decides whether the icon is drawn; it is not access control**: the DTR site is a public URL with its own sign-in, and anyone who has the address can open it.

**To add an app:** add one entry to `WORKSPACE_APPS` in `src/lib/apps.js` (id, name, description, https url, icon `clock` or `app`). A malformed entry (not https, no name, a repeated id) is left out instead of breaking the menu. A new icon means a new case in `AppIcon` in `src/components/AppsMenu.jsx` and its name in `APP_ICONS`.

**Not shared with the DTR app.** The DTR tracker is a separate Firebase project (`punx-dtr`) with its own sign-in (docs/DTR.md), so people may be asked to sign in there; nothing from the messenger session is passed along. A single sign-in across the two would be a separate piece of work (the only key between the directories is the email address).

**Checked.** 8 new tests (the DTR entry and its exact address; the list is complete and unique; only plain https links pass, including rejecting http, javascript:, data:, file:, relative and protocol-relative links, embedded credentials and bare hosts; a malformed entry is dropped; only the `developer` role passes, not `Developer`, a padded value, no role or a not-yet-loaded profile; the role matches the app's own `isDeveloper`; the header carries the menu; the link opens safely). 16 deliberate breakages, 15 caught at once; the survivor (no empty button when the list is empty) now has a guard. In a real browser with the real menu in a header like the real one: as a developer the toolbox sits between the pin and members icons, the menu shows the DTR tracker with the right address, new-tab and no-opener settings, and Escape and an outside click close it; as a super admin, an employee and with no profile there is no toolbox. The DTR site answers (HTTP 200). All 352 Node tests and the build pass.

**NOT checked.** In the real signed-in app (the browser check used the real menu in a stand-in header, with the role supplied by a stub), so the exact fit in each real header, and in a very narrow phone-width channel header, is unseen. Signing in on the DTR site from here. The Flutter app has no toolbox. Keyboard arrow-key movement inside the menu (it is Tab and Enter).
