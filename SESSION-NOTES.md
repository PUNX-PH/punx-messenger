# Session notes — 2026-10-14 to 2026-10-16

What was done, what is still waiting on you, and what was found but not fixed.

## 1. Where things stand (updated 2026-10-16)

PRs #1–#9, #11–#17, #19–#22, #24, #26–#28, #30–#65 are merged (#29 was a small fix to #28) (#10 was closed unmerged; #18, #23 and #25 were notes updates). Up to #13 (`2e15ef0`) I checked the deploy: Vercel and both Cloudflare Workers builds succeeded and https://plexus.punxai.online/ served it (the split bundle and its on-demand parts, the sound files, and the one-day cache on built files, section 13). **#15 (chat re-renders, section 14) and #16 (background blur, section 15) are merged to `main` (`f79b3c5`); their PR checks, including the Vercel build, were green. **Checked on the live site afterwards (2026-10-16, after #21): the login page loads four files and has no console errors, and the bundle contains the blur, chat-error and listener-banner code. It also showed that the blur model files were NOT being deployed: `/mediapipe/...` answered with the app's HTML, so blur would have failed on production with "Couldn't blur your background". Fixed in #22 and confirmed on the live site after it deployed (section 15).** None of these has been tried in the signed-in app. #14 was the notes, and #17 added CI and `CLAUDE.md` (section 16).

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

## 2. What shipped (PRs #1–#65)

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

**#65 — saved messages: a bookmark button that keeps a copy in My Notes** (section 58).

**#64 — forward a message to another conversation** (section 57).

**#63 — :emoji: suggestions in the message box** (section 56): type a colon and two letters.

**#62 — a visible Group settings button on the phone app's group screen** (section 55).

**#61 — an Add member button on the phone app's group screen** (section 54).

**#60 — link to a message** (section 53): a Copy link button in channels, and opening one scrolls to the message.

**#59 — a Copy text button on every message** (section 52).

**#58 — edit your last message with the up arrow** (section 51).

**#57 — a custom status** (section 50): a short line next to your name ("On leave"), with a choice of how long it stays.

**#56 — mute one channel or DM** (section 49): right-click it; it stops counting and stops dotting, and a muted DM stops pinging.

**#55 — mark as read, for one DM, all DMs, or everything** (section 48).

**#54 — a keyboard shortcuts sheet** (section 47): press `?` to see them.

**#53 — add everyone already here to PUNX TEAM** (section 46): a "Team group" card on the admin page, for developers and super admins, previews and then does the one-off job.

**#52 — the admin page no longer says super admins can read channels unseen** (section 45).

**#51 — new @punx.ai accounts join PUNX TEAM automatically** (section 44; `docs/ONBOARDING.md`): the Worker adds a new company account to the team group at first sign-in.

**#50 — the "New" line and "Jump to first unread" in the phone app** (section 43): the Flutter chat gets what the web got in #43, #44 and #46.

**#49 — the admin page no longer explains the developer role** (section 42): its role summary now says only that developers have dev tools.

**#48 — department filter on the calendar** (section 41): a dropdown under the calendar narrows who is shown on leave to one department; holidays are never filtered.

**#47 — unread badge on the tab icon** (section 40): the browser tab's icon gets a red badge with the number of conversations with something new, the same number and the same preference as the tab title.

**#46 — "Jump to first unread"** (section 39): a button at the top of a chat that takes you to the "New" line when it is scrolled out of sight above.

**#45 — switching chats shows nothing of the previous one** (section 38): a conversation no longer shows the previous one's messages, or is marked read, before its own messages have loaded.

**#44 — the "New" line takes your read time when you open the chat** (section 37): fixes the line going missing on a slow connection.

**#43 — a "New" line in chats** (section 37): opening a conversation with unread messages draws a red "New" line above the first one you had not read, and leaves it there while you read.

**#42 — leave count on busy days** (section 36): on the calendar grid a day with two or more people on leave shows the number ("9+" past nine) in place of the blue dot; one person keeps the plain dot.

**#40 — the calendar says why it failed** (section 35): after #39 the first real load showed only "Couldn't load the calendar right now"; the Worker now names the step that failed and the panel shows that line, so the cause can be read off the screen.

**#39 — DTR calendar widget** (section 34): a Calendar tile in the toolbox opens a popup of the DTR company calendar (holidays and who is on leave), with a lock that keeps it open while you chat; developers only for now.

**#38 — apps menu as a grid** (section 33): the toolbox menu shows app tiles (icon above the name, three to a row) instead of a list.

**#37 — apps toolbox** (section 32): a toolbox icon in the chat header that lists the company's other apps, starting with the DTR tracker; visible to developers only for now.

**#36 — chat backgrounds** (section 31): a faint pattern behind the messages, chosen in Appearance & preferences: simple textures, the Punx wordmark (corner, centre, repeating) and one drawing per team.

**#35 — next unread with the keyboard** (section 30): Alt+Shift+Down / Up opens the next unread conversation, from anywhere in the web app.

**#34 — drafts on the phone** (section 29): text typed in a chat and not sent is still there when you come back to that chat.

**#33 — plain-words errors across the Flutter app** (section 28): sending a message, changing a role, creating a group, creating or revoking an invite link, saving group settings and adding an emoji no longer print the raw Firestore error.

**#32 — first findings from the iPhone** (section 27): a DM that cannot be opened now says which step failed and why, and the add-reaction button no longer sits under every message on the phone.

**#31 — iOS ready to build** (section 26): the Firebase config is committed and wired, an unsigned iOS build passes in CI for the first time, and there is a one-command helper for the Mac.

**#30 — quick switcher** (section 25): Ctrl/Cmd+K jumps to any person or channel by typing.

**#28 — appearance and preferences** (section 24): theme, background, accent colour, text size, spacing, font, contrast, reduced motion, clock, send key, message grouping and the tab-title count, saved to the account.

Test counts on `main` at the end: **Flutter 1075**, **Node 1006** (sound, presence identity, lazy loader, iOS setup, chat identity, camera, attachments, threads, search filters, thread unread, spoilers, formatting), Worker 102, Firestore rules 216 (with the caveat in section 3).


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

## 33. Apps menu as a grid (PR #38)

**Why.** The toolbox menu (section 32) was a list; more apps are coming and a grid, like an app launcher, holds more in less space and reads faster.

**What.** The menu is three tiles to a row: a rounded icon tile with the app's name under it (up to two lines, then an ellipsis), the one-line description moved to the hover text (`title`), and the small "open in new tab" arrow removed (the menu header already says it opens in a new tab). More than about nine apps scroll (`max-h-80`). Nothing else changed: same list in `src/lib/apps.js`, same developer-only visibility, same safe-link rules.

**Checked.** One new test (grid, icon above the name, description still reachable, scrolls). Five deliberate breakages (back to a list, icon beside the name, description dropped, no scrolling, no new tab), all caught. Real browser with five stand-in apps (one with a very long name): three columns, two rows, tiles 87 px wide, the long name clamped to two lines (30 px tall) with the full name and description in the hover text; one cosmetic bug found and fixed there (a `block` class had cancelled the two-line limit). All 353 Node tests and the build pass.

**NOT checked.** The real signed-in app; a narrow phone-width header (the menu is capped at the screen width minus a margin but not looked at there); the hover text on a touch screen (it is not shown there, so on a phone the description is not visible; the name is).

## 34. DTR calendar widget (PR #39)

**Why.** The DTR app has a company calendar (its Department Calendar: holidays and everyone's approved leave and offsets). The request was a calendar widget in the messenger that pops up, with an option to lock it, using that calendar. Chosen with the user: it lives in the messenger, "lock" means pin it open, and it shows holidays and approved leave.

**What.** A **Calendar** tile in the toolbox (it is the first tile that runs something instead of opening a link: an entry in `src/lib/apps.js` is now a `url` or an `action`, never both). It opens a floating panel (top right, below the header): month grid with arrows and "Today"; an amber dot on holidays, a blue dot on days someone is on leave; click a day for its holidays and who is on leave ("Ana Reyes · SL", "Ben · OFFSET 4h", with their department). Rules are the DTR's: a multi-day holiday is on every day it covers; day-based leave skips weekends (a Friday-to-Monday sick leave does not paint the weekend); an offset claims its date.

**The lock.** The padlock in the panel's header pins it. Unpinned it is a popup: it closes on Escape and on a click outside. Pinned it does neither and stays open as you move between chats; it is remembered on the device and is open when the app starts (`punx.calendarPinned` in localStorage). The × always closes it and unpins it.

**How the data gets here.** The messenger cannot read the DTR's Firebase project (docs/DTR.md), so a new Worker route does: `GET /dtr/calendar?month=YYYY-MM` (`workers/src/routes/dtrCalendar.js`; details and the table in docs/DTR.md, "The calendar widget"). It verifies the caller's messenger ID token, reads `users/{uid}` and requires a role in `DTR_CALENDAR_ROLES` (default **developer**), reads only the DTR's `holidays`, `calendarEvents` and `departments`, caches the month for 5 minutes in KV, and returns each leave field by field (never a reason). The built-in Philippine holiday rules are a **vendored copy** of the DTR's `src/services/holidays.js` (commit 279ed7d3): keep it in sync by hand.

**Visible to developers only, for now**, in two places that must be widened together: `APPS_VISIBLE_TO` (client) and `DTR_CALENDAR_ROLES` (Worker, `wrangler.toml`). The client one only hides the button; the Worker one holds. Worth knowing: the DTR itself shows its own Department tab to super admins only while testing, so this gives developers a view the DTR does not (the DTR's rules do let any active DTR user read the same data).

**Checked.** 29 new client tests (month maths including a year-by-year check that the client grid and the Worker's date range agree for 2020-2036, the leave rules, wording, the pin, failure wording, the month cache, and guards on the wiring) and 25 new Worker tests with real RSA-signed tokens against an in-memory Firestore (who may ask, nothing of the DTR read for anyone refused, a demotion between two requests, only the three collections read, the range filter sent, the cache, malformed input, a seeded reason never appearing, the vendored holiday rules for 2026). 35 deliberate breakages, all caught. In a real browser (the real toolbox, host and panel; data from the Worker's own shaping code over made-up events): the Calendar tile opens it; grid, dots, day details, multi-day holiday, weekend rule, Sunday offset; month paging, one fetch per month and none when paging back; an offline failure with "Try again" and a 403 with no retry; unpinned popup closes on outside click and Escape; pinned stays through both and through a change of chat, survives a reload, and × unpins; fits a 375 px screen. All 385 web tests, 43 Worker tests and the build pass. The panel is its own 6.7 kB (2.6 kB gzipped) chunk, loaded on first use.

**NOT checked.** **Update, 2026-11-12: it has now run against the real DTR data**, by a developer on the live app, and loads (see section 35 for the 429 that came first). Still not checked by Claude: the signed-in messenger, and any day with real leave on it (the one screenshot seen showed holidays only). Safari and Firefox. Time zones: days are plain dates and the grid and "today" use the browser's local date, which is right for a team in the Philippines and could be a day off for someone far west. There is no department filter (the DTR's has one) and no way to refresh before the 5-minute cache runs out except "Try again" after a failure. The Flutter app has no calendar.

## 35. The calendar says why it failed (PR #40)

**Why.** Right after #39 shipped, a developer opened the Calendar tile on the live app and got "Couldn't load the calendar right now. Try again in a moment." That is the catch-all for a 5xx from the Worker (not a refusal, which has its own words, and not "no connection"), so the role check had passed and the failure was in reading or shaping the DTR data. The Worker already sent a reason in the response body, and the client threw it away; Worker logs could not be read from here (wrangler is not logged in, and logging in to the Cloudflare account is not something to do unasked).

**What.** The Worker (`workers/src/routes/dtrCalendar.js`) wraps each step so a failure says which one: `reading DTR holidays`, `reading DTR calendarEvents`, `reading DTR departments`, `shaping the month`, `reading the cache`, each followed by the cause ("Firestore query failed (403)", "TypeError: fetch failed"), clipped to 160 characters. Google's own error body is never passed on, and the message goes only to a caller who already passed the role check. A cache that cannot be written no longer fails the request (the month is just not cached). The client (`failureDetail` in `src/lib/dtrCalendar.js`) shows that line, small, under the plain words, for server-side failures only; a refusal, a bad month and "no connection" show nothing extra. It is rendered as text.

**Checked.** 2 new client tests and 4 new Worker tests (which collection failed and with what status, a dropped connection, a very long message, a missing `DTR_SERVICE_ACCOUNT` named for an allowed role while an employee still learns nothing, and a cache that fails to write). 10 deliberate breakages, all caught after two gaps were closed. 387 web tests, 47 Worker tests and the build pass.

**Outcome.** The first load after this deployed showed `reading DTR calendarEvents: Firestore query failed (429)`: Firestore refusing the read for quota, not a permissions or document-shape problem (the code was not at fault). The DTR project (`punx-dtr`) was then upgraded to the Blaze plan by the user, and the calendar loaded (November 2026 with the 1 and 30 November holidays). The most likely cause was the free plan's 50,000-reads-a-day cap; that was not confirmed from the Usage tab before the upgrade, so it is an inference from the status and from the fix working.

**NOT checked.** Whether the messenger's own project (`punx-msg`) is on Blaze or near its cap (it has the same exposure, and presence reads are its known cost). A budget alert on the DTR project is worth setting, since Blaze has no hard cap. A day with several people on leave (the panel lists each person; the grid shows one dot however many).

## 36. Leave count on busy days (PR #42)

**Why.** Asked after the calendar went live: the grid drew one blue dot on a day however many people were out, so a day with 12 away looked the same as a day with one. The request was a count on busy days.

**What.** `leaveCountLabel(n)` in `src/lib/dtrCalendar.js`: nothing for none or one (the plain dot stays), the number for two to nine, "9+" beyond. `CalendarPanel.jsx` draws it as a small pill in the dot's place (white with the brand colour on the selected day), beside the amber holiday dot when there is one. The number is the number of rows the day's list shows, so the grid and the list agree; a person with two leave entries on one day counts twice, as they get two rows. The accessible label already said "N on leave".

**Checked.** 2 new tests (the label's edges and non-numbers; the cell uses it and keeps the one-person dot), 7 deliberate breakages, all caught after one gap (the cell's use of the label) was closed. In a real browser with made-up data: 1 person = dot, 3 = "3", 12 = "9+" with 12 rows in the list, 2 beside a holiday = amber dot plus "2", 9 = "9"; selected busy day = white pill. All web tests and the build pass.

**NOT checked.** Real leave data (still only holidays seen on the live app), a phone-width screen (the cell width is unchanged and the pill is 14 px, but it was not looked at), Safari and Firefox, and a person's two entries on one day being merged into one (they are not).

## 37. A "New" line in chats (PR #43)

**Why.** The unread dot and the tab-title count say a chat has something new, but once you open it they vanish and nothing shows where the new part starts. A "New" line (Discord's red line) answers that.

**What.** When you open a conversation, the first batch of messages is compared with your last-read time for it (`firstUnreadId` in `src/lib/unread.js`), and a red "New" separator goes just above the first message you had not read (`buildBlocks` in `src/lib/messageBlocks.js` takes the id and starts a new group there; `MessageList.jsx` draws it). The decision is made **once per opening** (in `ChatSurface.jsx`, from the first batch, once your own read times have arrived) and kept: marking the chat read moves your last-read time 400 ms later, and that must not drag the line along. Leaving and coming back decides afresh, so a line from last time is gone unless something new arrived since.

**Where it does not go (on purpose).** Never read before (a new member is not told years of history are "new"). Your own messages are skipped (the line sits above the first unread one from someone else). If the first loaded message is itself unread there is no honest place for a line, since older ones may be unread too. Not in a read-only look at a channel you are not in, nor in private notes. It does **not** scroll you to the line: the view still opens at the latest message, so with many unread the line is above the fold.

**Checked.** 11 new tests (where the line goes and the cases above, the layout with and without it, a new day, and guards on the wiring), 15 deliberate breakages, all caught after three gaps were closed (one redundant guard removed, one loose wiring test tightened). In a real browser, the real message list with made-up messages: the "New" separator sits between the last read message and the first unread, and an unread author's run is split there; with no unread there is no separator. All web tests and the build pass.

**NOT checked.** The decision inside ChatSurface against live Firestore (it is covered by source-shape tests, since the component needs the live listener; not exercised in a browser here). Sign-in, a phone, Safari/Firefox. A conversation reopened while the tab is in the background. The Flutter app has no such line.

**Fix in #44 (found on a second look the day after).** #43 read your last-read time when the first batch of messages arrived. But a chat is marked read 400 ms after you open it whether or not its messages have loaded (the mark-read effect runs on the previous conversation's messages until the new ones arrive), so on any connection where the first batch takes longer than that, the time read was already "just now" and the line silently never appeared. The time is now taken at the moment of opening (the per-conversation reset effect in `ChatSurface.jsx`, which runs before the mark-read effect) and used when the batch arrives; if the user directory had not loaded by then, the current time is used as a fallback (only ever later, so the line can be late but never early). 1 new test (the capture is set up before the mark-read effect and the captured time wins), 5 breakages all caught. Still **not exercised against live Firestore.**

## 38. Switching chats: nothing of the previous one (PR #45)

**Why.** Found by reading the chat view with a second pair of eyes. `ChatSurface` stays mounted as you move between conversations (no `key` on the path in `Channel.jsx`, `DMConvo.jsx`, `MyNotes.jsx`) and kept one list of messages, replaced only when the new listener's first batch arrived. So for as long as that took (a fraction of a second from the cache, longer on a slow connection) you saw the **previous conversation's messages under the new one's title**, and the mark-read effect ran on them, marking the new conversation read after 400 ms before any of it was shown. (That second part is what made #44 necessary.)

**What.** The messages are now stored with the path they belong to (`batch = { path, docs }`) and read back through the current path: another conversation's messages read back as none, and `loaded` says when the ones shown are this conversation's. While not loaded, `MessageList` shows a blank pane (`role="status"`, `aria-busy`) rather than "This is the start of the conversation", and the mark-read effect waits for `loaded`. An empty conversation is `loaded` with no messages, so it still shows its empty state. A failed listener leaves this conversation with none (as before, and its error is shown as before).

**Checked.** 5 new tests, which are source-shape tests (the component needs the live listener), 10 deliberate breakages, all caught. In a real browser, the real message list with made-up messages swapped the way ChatSurface now feeds it: loading shows only the blank status pane (no old messages, no "start of the conversation"); after it, the right conversation's newest message is in view and the loading pane is gone; the resting position is the same as before this change (a direct swap of two chats lands the same 15 px, the list's bottom padding, above the end).

**NOT checked.** ChatSurface itself against live Firestore (listener timing, a really slow connection), sign-in, a phone, Safari/Firefox. The list's own scroll behaviour was only exercised through its props, not through a real conversation switch with a composer and images.

## 39. Jump to first unread (PR #46)

**Why.** The "New" line (section 37) is only useful if you can see it, and a chat opens at the newest message, so with more than a screenful unread the line is above the fold. A way back up to it finishes the feature.

**What.** When the "New" line has scrolled completely out of sight above the list, a pill at the top centre reads "Jump to first unread" (up arrow). Clicking it scrolls the line to the top of the list (a 16 px margin above it) and switches off "follow the newest", so a message arriving while you read from there does not pull the view back down. The button goes away as soon as the line is on screen, and is not shown when you are scrolled above the line (you will reach it) or when there is no line. `newLineIsAbove` in `src/lib/unread.js` is the rule; `MessageList.jsx` measures the real positions on every scroll and after the list changes, honours the "reduce motion" preference for the scroll, and the line is found by a `data-new-line` marker.

**Checked.** 3 new tests (the rule and its edges, unmeasurable input, and the wiring), 11 deliberate breakages, all caught after one gap (the marker test was too loose). In a real browser, the real message list with 60 made-up messages and the line in the middle: on opening the button shows with the list at the bottom; clicking puts the line 16 px from the top and removes the button; scrolled above the line there is no button; back at the bottom it returns; a message arriving while reading from the line leaves the scroll position unchanged; with no line there is no button. 409 web tests and the build pass.

**NOT checked.** Against live Firestore with a real unread chat (the line itself is decided in ChatSurface, section 37, and is likewise not yet seen live). The smooth scroll over a long distance: the browser pane used here was hidden, which paused smooth scrolling and delayed scroll events, so the scroll was verified with "reduce motion" on and with scroll events fired by hand; the logic is right in that setting but the animation itself was not watched. A phone, Safari/Firefox. The Flutter app has no such button.

## 40. Unread badge on the tab icon (PR #47)

**Why.** The tab title already carries "(3)" but a title is cut short in a crowded tab strip, and the icon is what you see. A red badge on the icon shows there is something new from another tab or window.

**What.** `FaviconBadge` (`src/components/FaviconBadge.jsx`, mounted beside `TabTitleUnread` while signed in) takes the same count (`useUnreadCount`) and obeys the same preference (**Unread count in the tab title and icon**, `tabTitleCount`; the label and hint in `PreferencesModal.jsx` now say so). While the count is above zero it draws the page's own icon (`/logo-punx.png`, a 447 px square) onto a 64 px canvas with a red circle in the top-right corner holding the number ("9+" past nine; a white ring so it reads on a dark or light tab strip; the red is the theme's `--bad`), and points `<link rel="icon">` at the result. At zero, with the preference off, on a drawing failure and on sign-out it points the link back at the original, which is remembered once. The rules (`badgeLabel`, `badgeGeometry`, `rgbFromTriplet`) are in `src/lib/faviconBadge.js`, free of the DOM and tested; only `renderBadgedIcon` touches a canvas.

**Also.** The new files, and `tests/chat-switch.test.mjs` from #45, had a stray UTF-8 byte-order mark (PowerShell 5.1's `Set-Content -Encoding utf8` adds one); removed. Worth remembering when converting line endings from PowerShell here: use `sed` or a script instead.

**Checked.** 11 new tests (label rules and edges, the badge always inside the icon at several sizes, the two-character font, the colour parsing and its fallback, and the wiring), 18 deliberate breakages, all caught after one gap (the cancel-a-stale-drawing cleanup) was closed. In a real browser with the real component and a stubbed count: the link starts as the plain icon; counts 3, 4 and 250 each give a different badged picture; 0 restores the plain icon; switching the preference off restores it and on brings the badge back. Rendered pictures looked at: "3" and "9+" legible at 128 px. 420 web tests and the build pass.

**NOT checked.** The icon in a real tab strip at 16 px (the picture at that size was too small to judge here), in Chrome, Firefox and Safari tabs (browsers differ in how quickly they redraw a changed icon, and Safari ignores some dynamic icons), a pinned tab, the installed app, and on a phone. The count itself is the existing `useUnreadCount`, which was not changed. The badge covers part of the logo by design (it must be readable at 16 px).

## 41. Department filter on the calendar (PR #48)

**Why.** Section 34's "NOT checked" listed the missing department filter (the DTR's own calendar has one). With a few dozen people the grid is crowded; "who in Creatives is out this week" is the usual question.

**What.** A dropdown under the legend ("Show leave for"): **All departments** (the default), then each department the Worker named, A to Z, then **No department** when someone on leave has none that is known (blank, missing, or an id not in the list; it also stays on offer while chosen, so the choice cannot vanish). It narrows the people on leave, in the grid dots and counts and in the day list alike; **holidays are company-wide and are never filtered**. It is shown only once the month has loaded and there is more than one choice. The choice is remembered on the device (`punx.calendarDepartment`, cleared by "All departments"); a remembered department that is no longer on offer (removed in the DTR) falls back to everyone rather than showing an empty calendar. The Worker already returned `departments` ({ id: name }) and each leave's `departmentId`, so **no Worker change**. The rules (`departmentOptions`, `filterLeaves`, `effectiveDepartment`, `readDepartment`/`writeDepartment`) are in `src/lib/dtrCalendar.js`, tested; the panel is `CalendarPanel.jsx`.

**Checked.** 20 new tests (ordering and tie-breaks, trimming and junk names, a list or text instead of the object, "No department" in each of its forms including an inherited-looking id like `toString` and a blank id in the list, exact matching only, the grid and list sharing one filtered result, remembering and clearing, storage that throws or holds junk, and guards on the wiring), 23 deliberate breakages, all caught after three gaps were closed (a blank id, a list instead of an object, and one redundant check removed). In a real browser, the real panel with made-up leave across four departments (one with nobody): options sorted with "No department" last; the 16th went 4 → 2 (Creatives) → a plain dot (No department) → nothing (HR) → 4 again; the holiday dot and the holiday in the day list stayed under every filter; the choice was stored and cleared; a reload kept "Creatives"; a stale saved id fell back to "All departments". All web tests and the build pass.

**NOT checked.** Real department names and ids from the DTR (the Worker returns whatever its `departments` collection holds, and a department with the same name twice would appear twice), the signed-in messenger, a phone-width screen, Safari/Firefox. The month-end counts per department are not shown in the dropdown. Nothing was done to the Flutter app, which has no calendar.

## 42. The admin page says only that developers have dev tools (PR #49)

**Why.** The role summary at the foot of the admin page ("Hierarchy:") spelled out what the developer role is: that it holds everything a super admin does, that groups a developer owns are invisible to super admins unless they are added, and that only a developer can grant or revoke the role. That is more than most people who can open the page should be told, and it describes how to find the one account that sits above the admins. Asked to hide it and say only that developers have dev tools.

**What.** `src/views/AdminPanel.jsx`: the paragraph now begins "Developers have dev tools." and goes on, unchanged in meaning, with super admins, admins, employees and guests. Nothing about what the role can see, hide or grant.

**What was deliberately left.** The behaviour (the rules in `firestore.rules`, `outsideDeveloperGroup`, who may grant the role) is unchanged. Other app text that only appears when someone tries to change a developer's account still names developers, because it is an error message for that action: "Only a developer can grant or revoke the developer role.", "Only a developer can remove or restore a developer account.", the tooltips on the locked role and remove controls, and the "Developers" count tile in the admin page's stats. `docs/ROLES.md` and code comments are internal and still describe the role fully. If those messages should be softened too, that is a small follow-up.

**Checked.** 4 new tests (the paragraph exists and says developers have dev tools; a list of phrases that must not appear in it; the rest of the summary is intact; developers are named exactly once in it), failing as they should against the old paragraph and against one with a leak added back. All web tests and the build pass.

**NOT checked.** The page in a browser (it needs an admin sign-in; the change is a static paragraph of text in JSX, and the build compiles it). The phone app has no such paragraph.

## 43. The "New" line and "Jump to first unread" in the phone app (PR #50)

**Why.** The web chat has had a red "New" line above the first message you had not read (section 37) and a button to get back to it (section 39); the phone app had neither. Same rule, same look, both apps.

**What.** `firstUnreadId` and `newLineIsAbove` (`android_app/lib/utils/new_line.dart`) are line-for-line the web's (`src/lib/unread.js`), with the same cases in `test/utils/new_line_test.dart`. `ChatSurface` takes your last-read time for the conversation **when it is opened** (`initState`, and again if the surface is pointed at another conversation), decides the line once from the first messages, and passes the id to `MessageListView`, exactly as the web does and for the same reason (#44): the chat is marked read 400 ms after opening whether or not its messages have loaded. `MessageListView` inserts a red **NEW** divider above that message (which also starts a group, so the line never cuts one person's run in two) and shows a **Jump to first unread** pill at the top when the divider has scrolled out of sight above.

**What is different from the web, and why.** The phone list is a lazily built `ListView`: a row far off screen has no widget to measure, and no widget to scroll to. So (1) whether the line is above is read from the list's own report of which rows are built (`_ReportingDelegate.didFinishLayout`) when its row is not built, and measured on screen when it is; (2) the jump first goes to a guess from the line's index, then steps a screen at a time towards it until its row exists, then scrolls it into place (10% from the top). Rows of very different heights make the first guess land short of the line or past it; both are tested. The pill's measurement is taken **after the frame** (once per frame): a scroll listener fires before the list is laid out at its new offset, so measuring there was one step behind, and a scroll that stopped exactly as the line crossed the top edge left the pill wrong. That bug was found by a test with very tall messages (where scrolling adds and removes no rows) and is covered by it.

**Checked.** 30 new tests: the helpers (same cases as the web), the line (drawn once, above the first unread, starts a group, announced to a screen reader as "New messages", absent without an id or with an unknown one), and the button (offered when the line is above, not when it is on screen or absent, takes you to the line from 120 and from 400 messages, from rows of very different heights in both directions, not offered once you scroll above the line, comes back past it, appears on a scroll that adds no rows, appears when the line is decided after the list is showing, a message arriving meanwhile does not pull the view away, read out as a button), plus source-shape tests on the `ChatSurface` decision (it needs live Firestore). Deliberate breakages in two rounds, **all caught** except two equivalent ones (a `<` versus `<=` where the row is always built at the boundary, and a redundant line that was deleted). `flutter analyze` is clean and all 323 tests pass.

**NOT checked.** **On a phone**: nothing here was run on a device or emulator; the behaviour is what Flutter's widget tests (which run the real list and layout, headless) show. In particular the real feel of the scroll animation, real row heights with images and long text, and a slow connection. The decision in `ChatSurface` against live Firestore (source-shape tests only). iOS. No Android build was made (no keystore here, by design): build on the other PC and look at a chat with unread messages before relying on it.

## 44. New @punx.ai accounts join PUNX TEAM automatically (PR #51)

**Why.** A new person opened the app to an empty sidebar until someone invited them to the team group. Asked for: every new `@punx.ai` account joins PUNX TEAM on its own. Full description and an operating guide: **`docs/ONBOARDING.md`**.

**What.** A person cannot add themselves to a group (the rules allow an admin, an invite or a member-managing bot only), so a new Worker route does it: `POST /onboarding/join-default-group` (`workers/src/routes/onboarding.js`). The web app (`src/lib/auth.jsx`) and the phone app (`auth_service.dart`) call it at sign-in, without waiting and without it ever affecting sign-in. The Worker re-checks everything: the email on the signed token is exactly `@punx.ai` (an externally allowed address is **not** added), the profile is staff and not a guest, not removed, not already stamped, and **created in the last 7 days**. Then, in one atomic Firestore commit, it appends the caller's uid to the group's `memberUids` (an array union, safe against two joining at once) and stamps `defaultGroupJoinedAt` on their profile (so someone who later leaves is not put back). Two new helpers in `workers/src/googleAuth.js`: `firestoreCommit` and `documentName`. **No change to `firestore.rules`.**

**Which group.** `DEFAULT_GROUP_NAME = "PUNX TEAM"` in `workers/wrangler.toml`: found by name ignoring case, and only if exactly one group has it and a developer, super admin or admin owns it (so a look-alike group made by an ordinary member is never where people land). `DEFAULT_GROUP_ID` pins an exact group instead.

**Checked.** 36 Worker tests (every "no" and its reason, the atomic commit, who is added and who is not, both ways to find the group, failures leaving nothing half done and nothing stamped, a profile removed between the check and the write failing the whole commit), 18 web tests (the client rule, and that the web rule and the Worker's share staff roles, the one-week window and the address check), 16 phone tests (the same rule, plus reading the Worker's file to pin its constants to the phone's). Deliberate breakages: 35 on the Worker and web, 17 on the phone, **all caught** after two gaps were closed (an empty domain matching an address that ends at the `@`, and the no-signed-in-user guard on the phone). All suites and builds pass.

**NOT checked.** **Against the real thing.** Nothing here has run on the live Worker with real Firestore: (1) that the Worker's service account is **allowed to write** to punx-msg's Firestore (it has been used for reads and for minting bot tokens; this is its first direct write), (2) that the group is **found**, i.e. that it is named PUNX TEAM and owned by a developer, super admin or admin (otherwise nothing is joined and the Worker's log says so; `DEFAULT_GROUP_ID` is the fix), and (3) the whole path from a real new sign-in. Do this once after the deploy: sign in with a brand-new `@punx.ai` account and look for PUNX TEAM in its sidebar. Also not checked: the phone app on a device, and the existing members (deliberately left alone: a backfill is a separate one-off job).

## 45. The admin page no longer says super admins can read channels unseen (PR #52)

**Why.** After #49 (section 42) the role summary on the admin page still said that super admins "can read every other channel without joining — invisibly, since they stay out of the member list until they're actually added". That tells every admin who opens the page that oversight exists and that it leaves no trace. Asked not to tell people that anyone can oversee them.

**What.** The summary now reads: "Developers have dev tools. Super admins manage the workspace and other admins. Admins can pin in any channel and manage any group. Employees join groups by invitation. Guests are invited to individual channels and see nothing else — not even the names of the other channels in the group." (`src/views/AdminPanel.jsx`.) `tests/admin-hierarchy.test.mjs` now also refuses a list of phrases (`without joining`, `invisibly`, `read every`, `every other channel`, `member list`, `oversee`, `oversight`, and others) in that paragraph.

**What was deliberately left.** The behaviour is unchanged (the rules, `canOversee`, who can read what). The labels that the overseeing super admin or developer sees on their OWN screen are unchanged too, because only they see them: the "Overseeing." note in `ChannelSidebar.jsx`, the oversight section of the server rail, and "You're overseeing this group as a super admin" in the voice room. `docs/ROLES.md` and code comments are internal. Nothing in the phone app says any of this.

**Checked.** The new test fails against the previous wording and against five oversight phrases added back one at a time (first attempt was a no-op: the paragraph wraps across lines and my edit did not match; redone against the real line). 463 web tests and the build pass.

**NOT checked.** The page in a browser (an admin sign-in is needed; it is a static paragraph of JSX and the build compiles it).

## 46. Add everyone already here to PUNX TEAM (PR #53)

**Why.** Section 44 made new `@punx.ai` accounts join PUNX TEAM on their own, but only accounts from the last week. Asked: add the existing members too.

**What.** A one-off job, run from the admin page, not by anyone holding the service account's key. `POST /onboarding/add-existing-members` (`workers/src/routes/onboarding.js`) with `?dry=1` for a preview that writes nothing. A **Team group** card at the foot of the admin page (`src/components/TeamGroupAdmin.jsx`, shown to developers and super admins, the same people who see the role controls) calls the preview, shows "N people would be added to PUNX TEAM (M already in)" and the first names, and only then offers **Add N people**. Who qualifies is section 44's rule plus "never a bot" (profiles with `type: 'bot'`); each reason someone is left out is counted in the preview. The Worker lets only `developer` and `super_admin` through, reads the caller's role fresh from their profile on every call, and requires a company address. Writes: the group's `memberUids` by array union in commits of 400, then `defaultGroupJoinedAt` stamps on every qualifying profile in commits of 200 (so someone who later leaves is not put back if it is run again). Each commit is atomic, the job is not; stopping part-way and running again finishes it. It refuses at 2000 accounts rather than do part, and answers 409 when no single trusted default group is found. Details: `docs/ONBOARDING.md`.

**Checked.** 19 new Worker tests (who may run it, from preview to commit, the exact counts and the reason for each person left out, nothing written by a preview, only the member list and the stamp touched, only people who need adding sent, a second run changes nothing, a person who left is not put back, chunking at 455 accounts, the 2000-account refusal at the limit as Firestore returns it, and a failure part-way leaving the group updated, no profile stamped and a re-run finishing), 10 new web tests (the wording, the access gate pinned to the Worker's, the two-step flow, the request shapes), and 36 deliberate breakages, **all caught** after three gaps were closed. The card was exercised in a real browser with the server calls stubbed: preview then confirm makes exactly one add call even if the button is pressed again while it works, "nobody to add" offers no add button, a failed preview and a failed add each show plain words and a way back. 473 web tests, 102 Worker tests, 339 Flutter tests, and the build pass.

**NOT checked.** **Against the real thing**, as in section 44: that the Worker's service account may write to punx-msg's Firestore, that the default group is found, and the real size of the workspace. Run the preview first and read the number and the names before confirming. Also not done: any change to the phone app (the card is web-only), and a record of who had left PUNX TEAM before this (none exists, so anyone who left on purpose is added once).

## 47. A keyboard shortcuts sheet (PR #54)

**Why.** The app has several keyboard shortcuts (Ctrl/Cmd+K, Alt+Shift+Down/Up, the send key, Esc) and nothing that lists them, so only the people who happened to be told knew them. First of four quality-of-life changes asked for together (the others: mark all as read, mute one channel or DM, a custom status; each its own PR).

**What.** Press **?** (when not typing in a text field) or use **See all keyboard shortcuts** under "Send a message with" in the preferences. A dialog lists the shortcuts in three groups: Move around (Ctrl/Cmd+K to jump to a conversation; Alt+Shift+Down for the one waiting longest; Alt+Shift+Up for the newest unread), Writing (send and new line, which **follow the person's own "Send a message with" setting** and update live; Up/Down and Enter/Tab in the @ list) and Anywhere (Esc; ? again hides it). Keys are written for the platform: Cmd and Option on a Mac, Ctrl and Alt elsewhere. `src/lib/shortcuts.js` is the one list (and the rule for when "?" counts); `ShortcutsHelp.jsx` is the dialog (the shared `Modal`, so Esc, a click outside and scroll-lock behave as in every other dialog); `ShortcutsHelpHost.jsx` listens, mounted beside the quick-switcher host; the dialog is its own chunk, loaded on first use and not preloaded.

**It lists only what exists.** When this was written there was no "edit your last message with the up arrow" and a test refused any sheet that claimed one; section 51 added it, and that test now pins the claim to the code instead. Every entry is pinned to the code that does it: the Ctrl/Cmd+K handler in `QuickSwitcherHost`, `unreadKeyDirection`, `shouldSend` for both settings, the @ list's keys in `Composer`, the Esc in `Modal`. If a shortcut is added or changed, this list is where it is written down, and the tests say so when it drifts.

**Checked.** 19 new tests and 36 deliberate breakages, all caught. In a real browser (the real host and dialog, a stubbed preference): a real "?" key press opens it; Esc closes it and restores scrolling; "?" typed in a text box goes into the box and opens nothing; "?" again closes it; switching the send setting while it is open rewrites the sending lines to "Ctrl Enter / Enter". 492 web tests and the build pass.

**NOT checked.** The Mac wording (Cmd, Option) beyond the tests of the labels; the dialog on a phone-width screen (it is the shared modal at `max-w-lg` and was not looked at there); the link inside the preferences dialog in the real app (it is wired and source-checked, and was not clicked). The phone app has no keyboard, so no sheet there.

## 48. Mark as read: one DM, all DMs, everything (PR #55)

**Why.** "Mark as read" existed only on a group's right-click menu. With a sidebar full of dots there was no way to clear a single DM or everything at once. Second of four quality-of-life changes asked for together.

**What.** Three ways in, one rule, one write.
- **A DM:** right-click it in the DM list for **Mark as read** (shown but disabled, saying "already read", when there is nothing to clear). Only a DM that has a conversation gets the menu.
- **All DMs:** a **Mark all read** link in the DM list header, shown only while at least one DM is unread.
- **Everything:** right-click the Home button on the rail, or hold it (the way the group icons open their menu), for **Mark everything as read**, with "N unread" beside it, or "all caught up" and disabled when there is nothing.
- The rule is `unreadKeys` (`src/lib/unread.js`): every conversation with a last message newer than when you last read it, in your DMs and in the channels of your groups. It is deliberately **wider than the badge** (`countUnread`): it also clears the channels of a **muted** group and a DM whose last message is your own, because both can still show a dot. A test checks that anything the badge counts is cleared. Groups you only oversee are not touched (they have no unread state).
- The write is `markManyRead` (`src/lib/db.js`): one update of your own profile per 300 conversations (`chunkKeys`), touching only `lastRead.<key>`, each to the server's clock like `markRead`. No rules change: a person already may update their own `lastRead`. `useMarkAllRead` shares `useConversationData` with the tab title and the quick switcher, so it adds no reads.

**Not done.** Touch: a DM row has no long-press menu (the rail's Home button does); on a phone-width screen the header's **Mark all read** is the way. The phone app has none of this.

**Checked.** 15 new tests (what counts as unread in DMs and channels; muted groups and own-last-message DMs cleared; a property check that the badge is never wider than "mark all"; nothing left to mark afterwards; odd input; batching; the write touching only lastRead; each entry point wired) and 34 deliberate breakages, all caught after four gaps were closed (an unused return value deleted, and three source checks that were too loose). In a real browser with the real rail and DM list and stubbed data: right-click Ana's DM then Mark as read wrote exactly her conversation and closed the menu; Ben's (read) item was disabled and writing nothing when clicked; the Home menu said "3 unread" and its click wrote exactly the unread DM, the unread channel and the muted group's unread channel, leaving the read DM and read channel out; the header link wrote the unread DM. 507 web tests and the build pass.

**NOT checked.** Against real Firestore (the write itself, and that the rules accept a many-key update of your own profile: they accept the same single-key update that `markRead` makes, and nothing in the rules looks at how many keys); a very large number of unread conversations; the menus on a touch device; Safari and Firefox.

## 49. Mute one channel or DM (PR #56)

**Why.** Muting existed only for a whole group. One noisy channel, or one chatty DM, could only be left, not quietened. Third of four quality-of-life changes asked for together.

**What.** Right-click a channel (text channels only) for **Mute channel** / **Unmute channel**, or a DM for **Mute conversation** / **Unmute conversation**. A muted conversation is **quiet, not hidden or blocked**:
- it stops counting towards the tab-title number, the tab-icon badge, "next unread" (Alt+Shift+Down/Up) and the quick switcher's unread boost;
- its row is dimmed, with no unread dot and no bold, and its group's rail icon no longer lights up for it alone;
- a muted DM stops pinging and stops showing OS notifications;
- it still opens normally and can still be found in the quick switcher, **a channel @mention still notifies** (as it does in a muted group), and **"Mark as read" still clears it** (section 48's rule is deliberately wider than the badge).
For channels the right-click menu is now open to every member on a text channel (before, only managers had a channel menu); "Manage access" and "Delete channel" are added only for managers, and a voice channel still has a menu for managers only (a voice channel has no unread to mute).

**How it is stored.** `mutedChats` on the person's own profile: a list of the same read keys `lastRead` uses (`dms__<id>`, `groups__<g>__channels__<c>`), changed by array union and removal (`toggleMuteChat` in `src/lib/db.js`) so two devices muting different things do not overwrite each other. **No rules change:** the rules let a person change any field of their own profile except role, email, uid, createdAt and the removal flags, and a test reads the real rules to prove `mutedChats` is not on that list. Like `lastRead` it is treated as personal in `usersIdentity.js` (live for you, dropped from everyone else's view of a person), so a toggle redraws only your own screen.

**One thing to know.** Like `lastRead` and `mutedGroups` today, the list sits on the profile document, which any signed-in client can read; the app never shows other people's. A DM key is `dms__<id>` and a DM's id is made from both people's ids, so someone inspecting the raw data could see that you muted a particular conversation. Keeping it truly private would mean a new owner-only document and a rules change; say if that matters.

**Not done.** Touch: a DM row and a channel row have no long-press menu, so on a phone-width screen there is no way to mute yet. The phone app has no mute for a single chat (it does have the group mute).

**Checked.** 18 new tests and 43 deliberate breakages, all caught on the first run. In a real browser with the real channel list and DM list and a live stubbed profile: an ordinary member right-clicking a text channel gets exactly "Mute channel"; clicking wrote the right key, and the row dimmed with no dot or bold and the title "(muted)"; the menu then said "Unmute channel" and unmuting brought the dot and bold back; a member has no menu on a voice channel; a DM's menu offered "Mark as read" and "Mute conversation", muting dimmed it and removed its dot, and the header's "Mark all read" disappeared because nothing dotted was left; as a group manager a text channel's menu was Mute, Manage access, Delete, and a voice channel's was Manage access and Delete only. 525 web tests and the build pass.

**NOT checked.** Against real Firestore (the write, and that the rules accept it: they do on a reading of them, tested). That a muted DM really stays silent in a browser with notifications granted. The menus on a touch device. Safari and Firefox.

## 50. A custom status (PR #57)

**Why.** There was no way to say "on leave" or "in a meeting" next to your name. Last of four quality-of-life changes asked for together (shortcuts #54, mark as read #55, mute one chat #56).

**What.** Click your name in the bottom-left panel (or **Set a status** in its gear menu). A dialog takes a line of text (60 characters), offers five ready-made ones (In a meeting, On leave, Out sick, Working remotely, Heads down), and **Clear after**: Today (the default, to the end of your own day), 1 hour, 4 hours, 7 days, or Don't clear. Saving shows it in four places: under your name in your own panel (in place of your role), under each person's name in the **member list** and in the **DM list**, and as the **DM header's subtitle**. Opening the dialog again pre-fills it and offers **Clear status**. The dialog is its own lazily loaded chunk. The phone app does not have it.

**How it is stored.** `status: { text, until }` on the person's own profile (`setMyStatus` in `src/lib/db.js`; `deleteField()` to clear); `until` is a time in milliseconds or null. **No rules change**: a person may change any field of their own profile but the protected ones, and a test reads the real rules to show `status` is not among them. **Expiry is decided where it is shown** (`statusOf` in `src/lib/status.js`): a status whose time has passed is simply not displayed, so nothing has to run to clear it.

**Other people's data is not trusted.** The rules let a person write anything into their own profile, so `statusOf` cleans what it reads from anyone: text only, one line, control characters and text-direction marks removed, cut at 60 characters (an emoji counts as one and is never split), a wrong type or an unusable end time shows nothing or no end. It is always shown as React text, never as markup. Checked with a 5,000-character status and a right-to-left override written straight into a profile.

**A bug the tests could not have found, found in the browser.** The member list builds each row as the user plus a field named `status` for the online/away dot, which **overwrote the profile's own `status`**, so no status ever showed there. Fixed by carrying the written one as `customStatus`, taken from the user, not the row; the exact bug is now in the breakage list and is caught.

**Also:** while writing the tests, the file-writing tool turned my `\u202E`-style escapes into the real invisible direction characters inside the source. They were replaced by visible escapes (13 of them, in `status.js` and its test), and a test now fails if any raw invisible or direction character appears in the status code or its tests, so this cannot creep back. Worth remembering when writing such characters through any tool.

**Checked.** 27 new tests and 58 deliberate breakages, all caught (after the escapes were fixed, three breakages that had not applied were re-run and caught; a redundant `Array.isArray` was deleted rather than tested). In a real browser (the real DM list, member list and your panel, with a live stubbed profile): another person's status shows in both lists; an expired one, a malformed one and a 5,000-character one (cut to 60, no direction characters left in the page) behave; clicking your name opens the dialog lazily with Save disabled while empty, no Clear button, "Today" chosen and the 60-character limit; picking a preset and "1 hour" and saving wrote exactly that text with an end time 60 minutes out, closed the dialog, and showed it on your panel and your member row; reopening pre-filled it and offered Clear; clearing wrote a delete and everything went back. 552 web tests and the build pass.

**NOT checked.** Against real Firestore (the write, and that the rules accept it: they do on a reading of them, tested). The DM header's subtitle in the real chat view (wired and source-checked, not seen). The dialog on a phone-width screen, Safari and Firefox. A status expiring while the screen is open: it disappears the next time that part of the screen redraws (presence redraws it every few seconds on most screens), which was not timed.

## 51. Edit your last message with the up arrow (PR #58)

**Why.** Fixing a typo meant hovering the message and finding the pencil. First of four small changes asked for together (the others: copy message text, link to a message, :emoji: suggestions; each its own PR).

**What.** In an **empty** message box, press **Up**: your newest message that has text opens for editing, the cursor in it. **Enter** saves, **Esc** cancels (as with the pencil), and either way the cursor goes **back to the message box**. An edit opened with the mouse behaves as before (the cursor is not moved). It is listed on the shortcuts sheet ("Edit your last message, when the box is empty").

**When the key counts** (`shouldEditLast`, `src/lib/editLast.js`): a plain Up, the box empty or only spaces, no picture or file attached, the @ list not open (it uses Up itself), no Shift/Ctrl/Cmd/Alt, no input method composing, and the key not already handled. In every other case the key does what it always did. It is also not taken when there is no message of yours to edit (the key is only swallowed when one was found). **Which message** (`lastEditableMessage`): the newest one **authored by you with non-blank text**, so a picture on its own is skipped, as the pencil is not offered on it either. Read-only views (oversight) have no message box, so there is nothing to press.

**How it is wired.** `Composer` reports the key through `onEditLast`; `ChatSurface` picks the message from the messages it holds and hands `MessageList` an `editRequest` ({ id, n }); the list opens it through the same `editingId` the pencil uses, so permissions, the edit field and the save path are unchanged (no new write, **no rules change**). The request is cleared when the conversation changes. `focusNonce` gives the box its cursor back when an edit that the key started ends.

**Checked.** 15 new tests (the key under every modifier and state, which message, wiring in the three components, the shortcuts entry pinned to the code) and 32 deliberate breakages: 31 caught at once, 1 survived (the `!meUid` guard, which a test then closed: with nobody signed in, a message without an author must not match "undefined is undefined"), and re-run, caught. In a real browser with the real chat, list and box (Firestore stubbed): Up opened the last message of mine (not the other person's last) with the cursor in it; Esc closed it and put the cursor back in the box; Up, typing and Enter saved exactly the edited text through the edit path (one write, to that message) and put the cursor back in the box, with nothing leaking into the box's own text; Up with text in the box did nothing; an edit opened with the pencil on an earlier message ended with Esc and left the cursor where it was. 567 web tests and the build pass.

**NOT checked.** Against real Firestore (the write is the existing edit; the rules already allow it). Safari, Firefox, a phone keyboard (there is no Up key on most; the pencil stays). An IME while composing (checked in the test, not with a real input method). The phone app does not have it. A message that is deleted by someone else while its edit is open from the key: the cursor is not returned to the box in that case.

## 52. Copy a message's text (PR #59)

**Why.** Copying a message meant selecting it by hand, which is awkward for a long one, a code block, or on a touch screen. Second of four small changes asked for together (after the up arrow in section 51; link to a message and :emoji: suggestions follow).

**What.** Every message that has text gets a **Copy text** button in its hover toolbar (after Reply). Click it and the icon becomes a tick with the label **Copied** for 1.5 seconds. Anyone who can see a message can copy it: it is not tied to being the author or to read-only views, because nothing is written anywhere. A picture on its own has no text, so no button.

**What is copied** (`copyableText`, `src/lib/copyText.js`): the text as written, so `**bold**`, `code` and code blocks still work when pasted into a message, with each mention turned from its stored `<@uid>` into **@Name**, the name the reader sees. Someone not in the directory is written **@Unknown**, exactly as the message itself shows it (a test pins the two together). The result is trimmed.

**The clipboard** (`copyToClipboard`, `src/lib/clipboard.js`, written to be reused by "Copy link"): the modern call first; if it is refused or missing (insecure page, an embedded frame, some in-app browsers), a hidden read-only text box and the old copy command, which cleans up after itself and gives the cursor back. It never throws and says whether it worked, and the button only shows "Copied" when it did. Nothing is written to Firestore. No rules change.

**Checked.** 18 new tests and 36 deliberate breakages, all caught after the gaps were closed (seven first survived: a null directory, the old way touching nothing without the copy command, the read-only attribute that stops a phone raising its keyboard, restarting the 1.5 seconds on a second click, the tick icon and the aria label; one more was a redundant `?.` inside a try, which was deleted instead). The tests also found a real bug in the first draft: the old way could throw before its try block when the page refused to create a text box. In a real browser (the real chat and message list, Firestore and the clipboard stubbed): the button is on every message with text, in other people's messages as well as mine, and not on a picture-only message; clicking wrote exactly the expected text (formatting and the line break intact, the unknown mention as written), the label read "Copied" and went back to "Copy text" after about 1.5 seconds. 585 web tests and the build pass.

**NOT checked.** The real clipboard (the pane's clipboard was stubbed, so the real permission prompt and the old fallback were tested with fakes, not a browser that refuses). Safari, Firefox, a phone. The button on a touch screen: the toolbar shows on hover or focus, so a tap on a message reveals it only where the browser treats a tap as hover (the same as Reply and Edit today). The phone app does not have it.

## 53. Link to a message (PR #60)

**Why.** There was no way to point a colleague at one message ("see this one") except quoting it. Third of four small changes asked for together (after the up arrow, section 51, and Copy text, section 52; :emoji: suggestions follow).

**What.** In a **channel**, each message's hover toolbar has **Copy link** (after Copy text); the icon turns into a tick, "Link copied", for 1.5 seconds. The link is `https://<this site>/g/<group>/c/<channel>?m=<message id>`. Opening it opens the channel, **scrolls to that message and lights it up** (the same highlight as jumping from a pinned message or a reply), then **removes the `?m=`** from the address so a refresh or Back does not jump again. It works for someone who is signed out: the sign-in page keeps the address, so they land on the message after signing in. Anyone without access to the channel gets what they always got.

**Channels only.** A DM's address is "the conversation with the other person", which reads differently to each of the two, so one link could not be right for both; private notes are not shared. Those get no Copy link button (a test pins it; `messageLink` returns null for them).

**An old message.** The chat holds only the newest 50. If the linked message is not among them, the window is widened **once** to 300 (one re-read of 300 messages, not page after page, which would re-read 50+100+150+... each time). If it is still not there, a note appears above the box: "That message isn't here any more. It may have been deleted, or be too old to load." (dismissible, gone after 8 seconds). It **floats over the top of the list** rather than taking space in the column: the first version took space, which shrank the list and left the newest message partly cut off, seen in the browser and fixed; rechecked, the newest message is fully visible with the note showing. The step logic is `nextLinkStep` in `src/lib/messageLink.js`; a model of the chat (0 to 2,000 messages, the target at the start, a third of the way, the end, or absent) checks that following always ends, asks for a wider window at most once, never when the message is on the first page, and finds exactly what is within reach.

**Safe by construction.** The id from the address is accepted only if it is a plain id (letters, digits, `_`, `-`, at most 64) and used only to find a message among the ones already loaded, never to build a path or a query. Nothing is written anywhere and there is **no rules change**. Copy text's "Copied" timer became a shared `useFlash` hook so the two buttons behave alike; `tests/chat-switch.test.mjs` and `tests/copy-text.test.mjs` were updated deliberately for that and for the batch now remembering the window size it was asked for.

**Checked.** 16 new tests and 57 deliberate breakages: 56 caught, 1 equivalent (an `else` written as `if (step !== 'jump')`); three redundant guards found by the first run were deleted rather than tested. In a real browser (the real chat with a 400-message stub and the real router; Firestore stubbed): a link to a message on the first page jumped to it with one read and removed `?m=`; one older than that read 50, then 300 (exactly once), found it, centred it (after the smooth scroll finished) and removed `?m=`; one older than 300 read 50 then 300, showed the note and removed `?m=`; Copy link in a channel wrote exactly `http://localhost:5199/g/G1abc/c/C2def?m=id399`, the label went to "Link copied" and back after about 1.5 seconds; the same toolbar in a DM had no Copy link. 601 web tests and the build pass.

**NOT checked.** The real sign-in redirect (read, not run: the sign-in page is rendered for every address when signed out, and the router keeps the query when it switches to the app). Real Firestore. A phone or Safari/Firefox. The real clipboard, as for Copy text. **A link pasted into a message opens in a new tab** (links in messages always do), so it reloads the app rather than moving within it; it works, it is just not instant. The phone app does not have it.

## 54. An Add member button on the phone app's group screen (PR #61)

**Why.** On the phone, adding someone to a group meant: Groups tab, **press and hold** the group, **Group settings**, scroll to Members, **Add member**. The long-press is invisible, so a group's owner could not find how to add people. The capability existed (ported with the settings screen, section on the phone app) but nothing on screen led to it, and the earlier quality-of-life scans looked at the web app and missed it.

**What.** Open a group on iPhone or Android: a **person-plus icon** ("Add member") sits in the top bar, for the people who may add (workspace admins, the group's admins, its owner; the same rule as the button inside Group settings, and the same one firestore.rules enforces: the owner is also in adminUids). Tapping it lists the people **who are not in the group yet, by name** (removed accounts never offered); picking one adds them and a note says "Added <name> to <group>", or says why not (the shared `describeError` wording, e.g. "You don't have permission to add that person..."). "Everyone is already in this group." when there is nobody left. Group settings keeps its own **Add member** button and now opens the **same sheet** (`add_member_sheet.dart`), so both behave alike.

**Not changed.** Group settings is still only reachable by press-and-hold; it was left alone on purpose (one concern per PR). A visible settings entry would be a sensible follow-up. No write is new: it is the existing `addMember`. **No rules change.**

**Checked.** 19 new Flutter tests (the rule for who may add, in every combination including "not known yet"; who is offered; the screen showing the button to the owner, a group admin and a workspace admin and not to a plain member; the list; adding exactly that person and closing; a failure saying so in words; the empty list; settings still adding through the shared sheet) and 22 deliberate breakages: 18 caught at once, 4 survived and were closed (sorting ignoring case; the workspace-admin case, which a test missed because three screens were pumped in one test and the later ones reused the first one's state, so the test was split; the error wording; settings still adding). Re-run: all caught. `flutter analyze` clean, 358 Flutter tests pass. Only changed files were formatted.

**NOT checked.** On a phone or an emulator (no Android build here, by design; no iPhone or Mac). The look of the icon in the top bar on small or large-text screens. Real Firestore (the add is the existing call). The web app is untouched by this PR (not re-checked here).

## 55. A visible Group settings button on the phone app (PR #62)

**Why.** Follow-up to section 54: Group settings was reachable only by pressing and holding the group on the Groups tab, which nobody finds without being told.

**What.** Open a group on iPhone or Android: a **gear icon** ("Group settings") in the top bar, next to Add member for those who may add. It is shown to **everyone in the group**, as the press-and-hold menu's item always was; what can be changed inside depends on the role, as before. It opens the same `GroupSettingsScreen`. The press-and-hold menu is unchanged. Hidden until the group is known.

**Checked.** 4 new Flutter tests (a plain member sees it, the owner sees it beside Add member, tapping opens the settings of *that* group, not before the group is known) and 6 deliberate breakages: 4 caught; 2 survived and are not worth a test (a different gear glyph; a commented-out blank line, which is no change). `flutter analyze` clean, 362 Flutter tests pass. A first run of the tap test failed because the settings screen reads the groups repository and the test had no Firebase; it now gives it a fake.

**NOT checked.** On a phone or emulator (no Android build here; no iPhone). How the two icons fit on a narrow screen with a long group name (the title truncates; not seen).

## 56. :emoji: suggestions in the message box (PR #63)

**Why.** Last of four small changes asked for together (the up arrow, section 51; Copy text, 52; link to a message, 53). Adding an emoji meant opening the picker with the mouse; the workspace's custom emojis could only be typed from memory.

**What.** In the message box, type a colon and at least two letters (`:fi`): a list of up to eight matches appears above the box ("Emoji matching :fi"). **Up/Down** move, **Enter or Tab** pick, **Esc** closes it, a click picks too (the cursor stays in the box). Picking replaces what was typed with the emoji and a space and puts the cursor after it. Two kinds are offered, best match first (exact, then starts-with, then contains; the workspace's own before the everyday ones at the same match): the **workspace's custom emojis** (written as their `:name:` token, which messages already turn into the picture, shown with a "custom" tag and their image) and **134 everyday emoji** by their usual names and the other names people type (`+1`, `lol`, `thanks`, `done`, `party`...). While the list is open Enter picks and does not send; with no matches (or Esc) Enter sends as always.

**When a colon counts** (`detectEmojiQuery`, `src/lib/emojiSuggest.js`): at the start of the text or after a space, a name starting with a letter (or `+`/`-`) and two or more name characters, at the caret. Times (`10:30`, `at :30`), links (`http://`), smileys (`:)`, `:3`), a lone `:o` and a finished `:fire:` are not taken. The list is cleared on sending and on moving to another conversation; the up-arrow-to-edit shortcut (section 51) still never fires while it is open.

**Safe by construction.** Nothing is written anywhere and nothing goes over the network: the everyday list is a table in the file (no invisible characters in the source: the picture-form marker is written by its code, and a test fails if one appears raw), the custom ones are the list the app already holds. A custom emoji entry that is malformed is skipped. No rules change.

**Checked.** 33 new tests and 57 deliberate breakages, all caught (12 first survived: ties broken by name, the best of an emoji's several names, a negative limit, the highlight staying inside the list, picking by mouse keeping the cursor, and four more wiring lines; each closed with a test, and one test I had written wrong was fixed before re-running so the second run was against a green baseline). In a real browser (the real message box, the custom emojis stubbed): `:fi` listed the custom `fire_dance` (tagged, with its picture) above 🔥 fire, 👊 fist, 🤞 crossed fingers; Down moved the highlight and Enter inserted 🔥 with a space, the cursor after it, nothing sent and the text kept; `:partyp` then Tab inserted `:partyparrot: `; `:smi` then Esc closed it and kept the text; `10:30` and `:zzqq` showed no list and Enter then sent (the box emptied); `:roc` then a mouse click inserted 🚀 and left the cursor in the box. 634 web tests and the build pass.

**NOT checked.** An input method (IME) composing: the list ignores Enter during composition (in the code, and pinned by a test), not tried with a real one. Safari, Firefox, a phone keyboard. Very long custom emoji lists (it shows eight). The list's look on a narrow screen. The phone app does not have it. A fully typed `:fire:` for an everyday emoji is not converted on send (only picked ones are), as before.

## 57. Forward a message (PR #64)

**Why.** Passing a message on meant copying its text by hand and losing who wrote it. First of three Discord/Viber-style features asked for together (forward, then saved messages, then voice messages; each its own PR).

**What.** Every message that has text or a picture gets a **Forward** button in its hover toolbar (after Copy text), except in a read-only oversight view. It opens **Forward message**: a one-line preview of what is being sent, a search box, and the places it can go: **people, text channels and your own notes** (not voice rooms, and not the conversation it is already in). **Up/Down** move, **Enter** or a click forwards, **Esc** closes. It says "Forwarded to <where>." and closes. The forward is a **new message from you**, shown with a small line **"Forwarded from <who wrote it>"** above it. Forwarding a forward keeps the ORIGINAL writer. For a person you have not messaged yet, the conversation is created first (as opening the DM does). One destination at a time.

**What is copied** (`src/lib/forward.js`): the text and the picture (with its details). **Not** copied: reactions, pin, reply, edit stamp, and where it was: a message from a private channel must not name that channel to people outside it. **Mentions are written as @Name**, not copied as tokens, so a forward cannot ping the people in it or tint the row as a mention for them (an unknown person reads @Unknown, as in Copy text).

**How it is stored.** One extra field on the new message, `forwardedFrom: { uid, name }` (null on every other message), written by the normal `sendMessage`. **No rules change**: the message rules check the author and membership, and they accept any other field (the rules were read to confirm this). The name shown is cleaned again on reading (one line, 60 characters, control and text-direction characters removed, nothing shown if unusable), because any member can write anything into a message.

**Checked.** 21 new tests and 58 deliberate breakages, all caught (6 first survived: a guard that turned out redundant and was deleted, the dialog re-enabling after a failure, which conversation is left out, the ranking, and the label's condition; closed with tests or deleted). In a real browser (the real chat with stubbed Firestore): the toolbar shows Forward; a forwarded message shows "Forwarded from Cara Diaz"; the dialog listed people, the other text channel and My Notes, and not the current channel or the voice room; the preview showed the mention as @Cara Diaz; Down then Enter ensured the DM exists, then sent to the right conversation path with the text (mention as a name), the original writer and no picture, showed "Forwarded to Cara Diaz.", and closed by itself. 655 web tests and the build pass.

**NOT checked.** Real Firestore (the write is the normal message create, which the rules accept on a reading of them). Forwarding a picture in the browser (copied in code and tested, not clicked). Sending to a channel you cannot post in: the send fails and the dialog says "Couldn't forward it" and stays open, which is tested in code only. Several destinations at once; forwarding with a comment added. A phone or Safari/Firefox. The phone app neither forwards nor shows the "Forwarded from" line (it shows the text as an ordinary message).

## 58. Saved messages (PR #65)

**Why.** Second of three Discord/Viber-style features asked for together (forward, section 57; saved messages; then voice messages). There was no way to keep a message to come back to.

**What.** Every message with text or a picture gets a **bookmark** button in its hover toolbar (after Forward), except in My Notes itself and in a read-only oversight view. Clicking it keeps a copy in **My Notes** and the icon turns into a tick saying **"Saved to My Notes"**; clicking it again says **"Already saved"**. In My Notes the copy shows **"Saved from <who wrote it>"** and, for a message that came from a **channel**, a **Go to message** link that takes you back into the app to that message (the link-following of section 53, scrolling to it and lighting it up, or telling you it is gone). The list of saved messages is My Notes (its empty text now says so).

**Why notes, and not a new list.** My Notes is already private (the rules let only its owner read or write `users/{uid}/notes`), so **no rules change and nothing new is stored where others can read it**. The first idea was a list on the person's profile; that document is readable by every signed-in person, so it would have copied private-channel text into it. A saved message is one note whose id comes from the message's id (`s_<message id>`), so saving twice is still one note. DMs are saved too but have no way back (a DM's address means different things to its two people, as in section 53).

**What is kept** (`src/lib/saved.js`, on the forward copy of section 57): the text and picture, who wrote it, mentions as names (a note never pings anyone), and where it came from. Not kept: reactions, pin, reply. The way back is read again on display and must be exactly `/g/<group>/c/<channel>?m=<id>`, so a note can only ever lead into this app.

**Checked.** 15 new tests and 53 deliberate breakages, all caught (3 first survived: a path anchor, one field of the stored note, and the icon swap; closed with tests). In a real browser (the real chat, Firestore stubbed): the toolbar shows the bookmark; the first click wrote one note to the right id with the text (mention as a name), the original writer and the way back, and the label read "Saved to My Notes" then went back after about 1.5 seconds; the second click wrote nothing and said "Already saved"; a saved note showed "Saved from Cara Diaz" with a Go to message link whose address was exactly the in-app route, and clicking it navigated inside the app (the message was too old for the stub, so it showed the "isn't here any more" note, as designed). 670 web tests and the build pass.

**NOT checked.** Against real Firestore (the write is a create in the owner's own notes, which the rules allow; the exists-check is a read of the same place). Saving a picture by clicking (copied in code and tested). Unsaving: delete the note in My Notes like any message of yours; there is no "remove bookmark" on the original. A phone or Safari/Firefox. The phone app has no bookmark button; it shows saved notes as ordinary notes.

## 59. Voice messages on the web (PR #66)

**Why.** Third of three Discord/Viber-style features asked for together (forward, section 57; saved messages, section 58; voice messages). Talking is quicker than typing, above all on a phone.

**What.** When the message box is empty, a **microphone** button replaces Send (and is not shown where the browser cannot record). Pressing it asks for the microphone, then the box becomes a recording bar: a pulsing dot, `0:07 / 1:00`, **Cancel** (bin) and **Send**. At one minute it stops and sends by itself. A recording shorter than 0.7 s is not sent ("too short"), and a refused or missing microphone says so in words. Leaving the conversation or the screen while recording throws the recording away and turns the microphone off. In the list a voice message is a pill: play/pause, a slider you can drag, and the time; only one plays at a time, and a recording that will not play says "Can't play". A voice message can be forwarded (section 57) and saved to My Notes (section 58); replying to one quotes it as `[voice message]`, and a DM's last-message line reads "🎤 Voice message".

**How it is stored.** Like pictures: there is no file storage, so the recording is embedded in the message as a base64 `data:` address (`audioURL`) with `audioMeta: { durationMs, mime }`. A minute at the speech bit rate (16 kbit/s) is about 160 KB of text; the limit is 700,000 characters, which leaves room in the 1 MiB document. **No rules change**: the message rules check the author and membership, not the fields (`firestore.rules` untouched).

**Only that exact shape is ever played** (`isPlayableAudioURL`): `data:audio/...;base64,...` and nothing else. A message from someone else cannot make a viewer's browser fetch from a stranger's server, because a web address, a `blob:` address, a non-audio type or a non-base64 string is simply not a voice message.

**Which format (this matters for phones).** An iPhone cannot play WebM or Ogg, which is what Chrome and Firefox record by default, so a voice message recorded on a Windows or Android Chrome would have been **silent for an iPhone user**. The recorder therefore asks first for **AAC in MP4** (`audio/mp4;codecs=mp4a.40.2`), which every phone and browser plays; Safari and Chrome 126+ can make it. Firefox cannot, and falls back to Opus in WebM or Ogg (those play on Android and on desktop, and show "Can't play" on an iPhone: see section 60 for what the phone app does). Asking for plain `audio/mp4` is not enough: a real Chrome answers it with **Opus inside MP4**, which was found only by recording in a real browser; it is now the last resort only.

**The microphone is never left on.** Every way out of a recording (sent, cancelled, ran out of time, failed, the box unmounted, the conversation changed) stops every track (`src/lib/voiceRecorder.js`, tested with a stand-in recorder including one that never reports that it stopped).

**Checked.** 43 new web tests (713 in all pass) and about 130 deliberate breakages across the recorder, the format rules, the box, the player, send, forward and save: all caught after closing the first survivors, of which some were real: a limit that said "time is up" on every tick after the limit instead of once and stopped by itself, a cancel that did not turn the microphone off if the recorder never reported stopping, and source checks that an older line elsewhere in the file satisfied. A first breakage run died when a failing test left a timer running; each check now has a time limit. In a real browser (Chrome 156, a synthetic tone as the microphone, the real `MediaRecorder` and the real player): it recorded `audio/mp4;codecs=mp4a.40.2`, the result passed the playable check, the player played it (position advanced, 0:01 / 0:02, the slider moved, pause showed), the microphone track was stopped, and the pill fits a 375 px screen with no sideways scroll. The build passes.

**NOT checked.** A real microphone and the browser's permission prompt. Real Firestore (the write is the normal message create, which the rules accept on a reading of them). **Safari, an iPhone, an Android phone, Firefox**: the format choice is by what each browser says it supports, and AAC/MP4 playback on an iPhone is the documented behaviour, not something seen here. Recording while a call is live (the browser may refuse or share the microphone). A very long recording on a slow device (the one-minute limit stops it, but its memory use was not measured). The phone app does not record or play yet: see section 60.

## 60. Voice messages on the phone app: playing them (PR #67)

**Why.** Section 59 added voice messages to the web. Without this, a voice message sent from the web showed on the phone app as an **empty message** (no text, no picture). "Make sure this works on iOS and Android" is only half answered by this PR: **the phone app can now play and show them; it cannot record yet** (see below for why).

**What.** A message with a voice message shows a pill like the web's: play/pause, a slider you can drag, the time (`0:03 / 0:08`). One plays at a time. It is quoted as `[voice message]` in a reply and in the pinned-messages list (`ChatMessage.previewText`, also used for pictures). Only the same exact shape as the web is ever played (`data:audio/<known type>;base64,...`, at most 700,000 characters; `lib/models/voice_clip.dart` mirrors `voiceMessage.js`), so a message cannot make the phone fetch from anywhere.

**While a call or a voice channel is live it does not play** and says "Leave the call to listen to voice messages." The phone has one audio session and the call owns it; the sound effects take the same care (`sfx_service.dart`, `isLiveAudio`). A message already playing can still be paused. The player sets **no audio context** on purpose: on Android `audioplayers` applies a context to the whole phone, so setting one when a person taps play could reset the audio mode under a call.

**iPhone and WebM/Ogg.** An iPhone's player cannot read WebM or Ogg, which is what Chrome and Firefox record when they cannot make MP4 (the web app now records AAC in MP4 first, section 59). Such a message shows "Can't play" on an iPhone without trying, instead of failing silently. Android tries everything. Messages already sent as WebM stay that way.

**Checked.** 40 new Flutter tests (402 pass in CI, 362 before) (the address check including a trailing newline and a size limit that is exact; the player's rules with a stand-in player: play, pause, resume, one at a time, end of file, the file's own length, seek clamped, a recording that cannot be read, an iPhone offered WebM, going away mid-failure; the pill in a real message row: shows, plays, slider, blocked during a call, can still be paused when a call starts, "Can't play"). 25 deliberate breakages: 24 caught, 1 survived and was a redundant guard that was deleted. Writing the tests found one real bug: two releases of the same player at once (the screen going away while a failed one was being let go) walked the same list and threw; fixed and pinned. `flutter analyze` clean.

**NOT checked.** **Nothing here has run on a phone**: not on an iPhone, not on an Android. The `audioplayers` call (`BytesSource` with a type) is the standard one but was never heard. In particular: whether an iPhone plays AAC/MP4 through it, whether it plays with the silent switch on (no audio context is set, so it follows whatever the app's session already is; the sound effects use "ambient", which obeys the switch), and whether it disturbs a call that starts afterwards. **Recording on the phone is not built**: it needs a new native plugin (microphone capture to AAC), which cannot be built or tried here (no Android build without the keystore, no Mac), and it would touch the same audio session the call uses; it should be done with a phone in hand. The microphone permission is already declared on both platforms (for calls).

## 61. Copy text on the phone app (PR #68)

**Why.** The web has had **Copy text** on a message since section 52; the phone app's long-press menu (Reply, React, Pin, Edit, Delete) had nothing, and copying a message is one of the things people do most on a phone. First of the phone-app catch-up items (the standing direction: the same quality of life on web and phone).

**What.** Long-press a message that has text: **Copy text** (after React). It puts the text on the clipboard and says "Copied" for two seconds, or "Couldn't copy" if the clipboard refuses (it does not claim success). It is not offered for a picture or a voice message with no words. What is copied is the same as on the web (`lib/utils/copy_text.dart` mirrors `src/lib/copyText.js`): the text as written, so **bold** and `code` still work when pasted back, trimmed, with every mention turned from the stored `<@uid>` token back into the name people see (`@Cara Diaz`; `@Unknown` for someone who has left or has no name).

**Checked.** 12 new Flutter tests (the text rules; the menu offering it only where there is text; a tap copying, closing the menu and saying Copied; a mention copied as a name; a refusing clipboard saying so; nothing offered for a voice message). 17 deliberate breakages: 15 caught; 2 survived: a redundant guard (blank text copies as nothing anyway; deleted) and a rewrite of the "hide the last message first" line that does the same thing. `flutter analyze` clean.

**NOT checked.** On a phone, either kind: the system clipboard was a stand-in in the tests. Android 13+ shows its own "copied" confirmation on top of ours; whether the two together look cluttered was not seen. iOS may show a paste-permission prompt in other apps when pasting; that is the system's, not ours. "Copy link" to a message (section 53) is not on the phone: the phone app has no handling of `?m=` links (its router reads no query parameters and the app has no app links), so a link copied there could not land on the message.

## 62. Mute one channel or DM on the phone app (PR #69)

**Why.** Section 49 added muting a single channel or DM on the web; the phone app could only mute a whole group, so a noisy channel or a chatty DM could not be quieted from a phone. Second of the phone-app catch-up items (after Copy text, section 61).

**What.** Long-press a **channel** or a **DM** in its list: **Mute channel** / **Mute conversation** (or **Unmute ...**), as a plain member too. For an admin the channel menu also has **Channel access** (what the long-press used to open directly). A muted conversation shows a bell with a line through it and is never bold or dotted as unread; it no longer lights up its group in the group list; and a muted DM neither plays the in-app ping nor shows a system notification. It is quiet, not hidden: it opens normally and an @mention in a channel still notifies, as on the web. A voice channel has nothing to mute, so an admin long-pressing it goes straight to access as before and anyone else gets nothing. A DM row with no conversation yet has no menu (nothing to mute until two people have written).

**How it is stored.** The same field the web writes: `mutedChats` on the person's own `users/{uid}` document, a list of read keys (`dms__<id>`, `groups__<g>__channels__<c>`), added with `arrayUnion` and removed with `arrayRemove`. So a mute made on the web holds on the phone and the other way round. **No rules change** (the web already writes it). Like `lastRead` it is read from the person's own profile and left out of the shared identity (`users_identity.dart`), so other people's mutes are never needed or carried around.

**Checked.** 32 new Flutter tests (the wording; the profile reading `mutedChats` tolerantly: absent, not a list, non-text and empty entries; `isChatMuted`; a muted channel not lighting its group up while another unread one still does; in the real channel and DM lists: bold, bell, the long-press menus for a member and an admin, Mute and Unmute each asking for exactly that key and closing the menu, a failure saying so, Channel access still opening; no menu for a DM with no conversation). 28 deliberate breakages: 27 caught, 1 survived (the voice-channel path of the long-press) and was closed with a test that pins it. `flutter analyze` clean.

**NOT checked.** On a phone, either kind. **Real Firestore**: there is no Firestore fake in this project, so the write itself is pinned against the web's (same field, union to mute, remove to unmute) rather than run. The notification path (`notification_listener_service.dart`) talks to Firestore directly and cannot run in a test; the mute check before the ping and the notification is pinned by its position in the source, not exercised. The voice-channel long-press is pinned the same way, because the real voice controller cannot be built and torn down in a widget test (its dispose reads a provider after the container is gone; this is how it already behaved, not something this change added). Muting from inside an open chat (a bell in its top bar) is not offered on the phone: only the list's long-press, which is not obvious; a hint for it was not added.

## 63. A custom status on the phone app (PR #70)

**Why.** Section 50 added a custom status on the web ("In a meeting", "On leave", optionally clearing by itself). The phone app neither showed other people's nor let you set your own, so a colleague who had written "On leave" looked available to anyone on a phone. Third of the phone-app catch-up items.

**What.** Your own: open your avatar's sheet and tap the new first row, **Set a status** (or your current status with "Tap to change it"). It opens a sheet with the text (60 characters), the five ready-made statuses (In a meeting, On leave, Out sick, Working remotely, Heads down), **Clear after** (Today, 1 hour, 4 hours, 7 days, Don't clear; Today is chosen to begin with and means the end of your own day), **Save**, **Cancel**, and **Clear status** when you have one. Others': a status shows under a person's name in the DM list, and under their name in the title bar of a DM with them (read from the live directory, so it changes while the chat is open).

**How it is stored.** The same field the web writes: `status: { text, until }` on the person's own `users/{uid}` document (`until` in milliseconds, or null for never), deleted to clear it. So one set on the web shows on the phone and the other way round. **No rules change.** It is part of the shared identity (`users_identity.dart`), because it is shown for everyone, unlike `lastRead` and `mutedChats`.

**What is trusted.** Nothing read from someone else's profile: the rules let a person write any text into their own, so on the way in (`models/custom_status.dart`, mirroring `status.js`) it is cut to one line of at most 60 characters (counting a character outside the basic plane as one, never splitting it), control characters become spaces, and the marks that make text run right-to-left or flip around its neighbours are removed. It is cleaned again on the way out, so only a short clean line is ever written, whatever called the repository. Whether a status has ended is decided where it is shown (`activeStatusOf`), so nothing has to run to clear it.

**Checked.** 55 new Flutter tests (cleaning each unwanted range and the characters just either side of it, the cut at 60 including emoji, parsing every wrong shape, the exact moment a status ends, each length, the sheet in each state: empty, filled, expired, blanks, typing past 60, presets, the length chips, what is written for each, Clear, Cancel, a failure to save and to clear, everything held still while saving and a second tap saving nothing more; the row in the profile sheet; the DM list with a live, absent and ended status). 51 deliberate breakages: 49 caught, 2 survived (the repository's second cleaning pass, which cannot run without Firestore, and the Save button staying enabled during a save) and were closed with a pin and a test. Writing the tests found a real layout bug: with **Clear status** showing, the three buttons overflowed a 390-pixel-wide screen by 44 pixels; they now wrap. `flutter analyze` clean.

**NOT checked.** On a phone, either kind. **Real Firestore** (the write is pinned against the web's: the field on the person's own document, deleted to clear). The title bar's second line and the profile sheet's own wiring are pinned by their source, not exercised: neither the chat screen nor the profile sheet can be built in a widget test (the profile sheet builds the real voice controller, which does not tear down cleanly in a test). An expired status disappears the next time its screen is rebuilt, not at the moment it ends (the web ticks a clock; the phone does not). It is shown only in the DM list and a DM's title bar: not beside message authors and not in any group member list (the web shows it in its members panel; whether the phone has a place that matches was not looked into).

## 64. Save a message to My Notes on the phone app (PR #71)

**Why.** Section 58 added a bookmark on the web that keeps a copy of a message in My Notes. The phone app had no way to keep a message, and a note saved on the web showed there without saying whose message it was. Fourth of the phone-app catch-up items.

**What.** Long-press a message that has text, a picture or a voice message: **Save to My Notes** (not offered inside My Notes itself). It says "Saved to My Notes", "Already saved" (saving the same message twice is one note: the note's id is made from the message's), or "Couldn't save". A copy in My Notes, and any forwarded message, now shows who wrote it first above its content: **Saved from Dan Cruz** (bookmark icon) or **Forwarded from Dan Cruz** (arrow icon), the same wording as the web, including for copies made on the web.

**What is copied** (`lib/utils/forward.dart`, mirroring `forward.js`; the same copy a forward will make, which is why it is here first): the text with mentions written as @Name (a note never pings anyone), the picture with its details, the voice message with its length and type, and who wrote it (their name as it is now, falling back to the name on the message, then to "Unknown"; a message that was itself forwarded keeps its ORIGINAL writer). Not copied: reactions, pin, reply, edit stamp.

**How it is stored.** Exactly what the web writes (`messages_repository.dart` `saveMessageToNotes`, mirroring `db.js`): a new document in the person's own `users/{uid}/notes`, with `forwardedFrom` and `savedFrom: { route }`. For a channel message the route is the web's address (`/g/<group>/c/<channel>?m=<message>`), so the web's "Go to message" works on a note saved from a phone; a DM message has none. **No rules change** (the owner already writes their own notes). Everything read back (the writer's name) is cleaned again, as for a status.

**Checked.** 46 new Flutter tests (the writer's name read from any shape; who the copy says it is from, including a blank directory name, no name at all, an over-long one, and a forwarded message keeping its first writer; what can be passed on; the note's id and the exact address; the menu entry in each place it should and should not be; each of the three outcomes; the labels; the wiring). 44 deliberate breakages: 42 caught, 2 survived (a copy carrying an empty picture address or orphaned picture details) and were closed with a test. `flutter analyze` clean.

**NOT checked.** On a phone, either kind. **Real Firestore**: there is no Firestore fake in this project, so the existence check and the write are pinned against the web's, not run; neither is the controller (it needs the signed-in profile and the directory), which is pinned the same way. **"Go to message" is not on the phone**: its router does not read `?m=` links, so a note shows who wrote the message but cannot take you back to it (the web can). Saving from a message that arrives while it is open, the order of two saves in quick succession, and the real "already saved" read were not tried. Forwarding to another conversation (the next catch-up item) is not built yet, though forwarded messages already show their label.

## 65. Forward a message on the phone app (PR #72)

**Why.** Section 57 added Forward on the web; the phone app could only save a message to My Notes (section 64). Last of the phone-app catch-up items (copy text, mute, status, save, forward), so the phone now has every one of the web's message actions except link-to-a-message.

**What.** Long-press a message that has text, a picture or a voice message: **Forward**. A sheet shows the message (who wrote it and one line of it), a search box and a list of where it can go: **My Notes**, people, and text channels (named by their group, "in Team"), not voice rooms and not the conversation it is already in. Tapping one sends it there as a new message from you, marked "Forwarded from <whoever wrote it first>"; the sheet closes and a note says "Forwarded to #random" / "Forwarded to Ana Reyes" / "Forwarded to your notes". If it fails the sheet stays open with "Couldn't forward it. Check your connection and try again." and you can tap again. One destination at a time; nothing else can be tapped while one is going. A person you have never messaged gets their conversation made first, as on the web.

**The list and its ranking** (`lib/utils/forward_targets.dart`, mirroring `quickSwitch.js` and the destination rules of `forward.js`). With nothing typed: what is unread, then what was active most recently, then by name. Typing: every word must match; a name that starts with it beats a word that starts with it, which beats the middle of a word, which beats the group's name, which beats letters picked out in order from the start of a word ("mkt" finds "marketing", "ana" does not find "brand-assets"); unread rises; a leading **#** means channels only and **@** people only. Differences from the web, on purpose or not: accents are stripped for the common Latin letters ("Zoë" is found by "zoe") rather than every combining mark; names that tie are told apart ignoring case, as the web's `localeCompare` does.

**What is copied** is section 64's copy (`utils/forward.dart`): the text with mentions as names (a forward never pings), the picture with its details, the voice message with its length and type, and who wrote it first (a forward of a forward keeps the original writer). A picture is stored as it already is (no re-encoding), the way a GIF already was. To carry a voice message and the "forwarded from" mark, `sendMessage` now accepts both; a DM's last-message line says "Voice message" for one, as on the web.

**How it is stored.** The normal message create the web uses, into the destination's messages collection (`users/{uid}/notes`, `dms/<id>/messages`, `groups/<g>/channels/<c>/messages`). **No rules change**: the message rules check the author and membership, not these fields (section 57).

**Checked.** 54 new Flutter tests (the targets: yourself, voice rooms and the current conversation left out, the exact conversation id, name fallbacks, unread for a DM and for a channel with muted chats and groups; the ranking: every score tier, every word must match, accents and case, # and @, unread rising but not beating a better match, ties, limits; the sheet: what it shows, what it offers, narrowing, the note for each kind of destination, a second tap while one is going, failing and trying again, a send that throws, Cancel; the menu entry in each place it should and should not be). 65 deliberate breakages: 61 caught the first time; 4 survived (a match on the group name's score, the name tie ignoring case, the writer's CURRENT name in the preview, the face and mark beside each row) and were closed with tests; all caught after. One guard that turned out redundant (a list row disabled while sending, on top of the same check in code) was deleted. `flutter analyze` clean.

**NOT checked.** On a phone, either kind. **Real Firestore**: there is no Firestore fake in this project, so the send (including making a DM's conversation first) is pinned against what the web does, not run; the controller and the screen's wiring are pinned the same way, because the chat screen cannot be built in a widget test. A forwarded picture or voice message was only tested as data, not seen arriving. Forwarding while offline (not tried: the write may wait for the connection, in which case the sheet stays busy until it returns). Accents beyond the common Latin letters. A very long list of channels across many groups (every group's channels are listened to while the sheet is open; not measured). Forwarding from inside My Notes is offered (the web offers it too). Voice and picture messages forwarded to a conversation whose members' phones cannot play the format are subject to the same iPhone limit as any voice message (section 60).

## 66. Do not disturb on the web (PR #73)

**Why.** Muting a conversation (section 62) is one chat at a time. There was no way to say "leave me alone for an hour" across everything.

**What.** The gear menu in the bottom-left panel has **Do not disturb…**: a box with 30 minutes, 1 hour, 4 hours, until 8:00 in the morning, or until you turn it off. One click on a choice turns it on. While it is on: no ping sound and no desktop notification, for DMs and for @mentions; your own avatar gets a red dot; a red bell sits beside the gear (click it to turn it off), and the gear menu says "Turn off do not disturb (until 3:40 PM)", in your 12/24-hour choice. It is quiet, not blocked: messages still arrive and still count as unread (muting a chat is what stops that), and nothing is hidden. It turns itself off when its time comes; nothing runs to do that (the end time is checked where it is used).

**How it is stored.** `users/{uid}.dnd = { until }`, where `until` is a time in ms or an explicit `null` for "until I turn it off"; turning it off deletes the field (`setMyDnd` in `db.js`). A field of your own profile, so **no rules change**. It is on the own-only list in `usersIdentity.js` with `lastRead` and `mutedChats`: nobody else's screen carries it or redraws for it, and others do not see the red dot. The profile document itself is readable by everyone signed in, like every field on it, so it is not secret, just not shown. A stored value that is missing or the wrong type (text, NaN, Infinity, an array) reads as OFF, never as on for ever.

**Where the decision is made.** `announcePlan` (`src/lib/dnd.js`) turns "do not disturb, is it a DM, am I looking at it, may I show a notification" into "ping or not, notify or not". The notification daemon asks it for every message, reading do-not-disturb through the same ref it already uses for the user directory at that moment, so switching it on, off, or running out applies to the next message with no re-subscribing. The message is recorded as seen BEFORE the question is asked, so what arrived during do-not-disturb is not replayed as a burst when it ends.

**Not changed.** (The phone app reads this field too since section 67.) A call ringing is not touched (there is no call-ring code in the notification daemon). The tab-title and favicon unread count still counts, as for a muted chat.

**Checked.** 24 new tests (each choice's end; the morning at 3:00, 7:59, exactly 8:00, 23:59 and across the end of a month and a year; on / off / the exact moment it ends; 19 shapes of bad stored data; the wording for today, tomorrow, further away, another month with the same day number, 12-hour and 24-hour; the full ping and notification table with do-not-disturb on and off; the identity; and the daemon, the write, the panel and the box pinned against their source, because the daemon and panel cannot run in Node). 54 deliberate breakages, all caught in the end. The first round found 12 that survived: two guards that did nothing (an object check and a number-type check, because a wrong type already reads as nothing) were deleted; the rest were real gaps (a date a month later with the same day number counted as today or tomorrow; the far-date wording; the recorded-before-asked order; the panel's indicator and the box closing; the buttons coming back after a failed save) and were closed with tests. All 737 Node tests and the build pass.

**NOT checked.** In the real app: I cannot sign in here, so the box, the red dot, the bell, the menu entry and the lack of a ping were not seen or heard. A real desktop notification being suppressed was not tried. Whether the red dot is clear on the avatar at 32 px, and the bell's colour against the panel. Two tabs open on the same account (both read the same field, so they should agree; not tried). A device whose clock is wrong decides "has it run out" by that clock. The line under your name still shows your status: an earlier version replaced it with "Do not disturb", and that was removed so a status you wrote is never hidden.

## 67. Do not disturb on the phone app (PR #74)

**Why.** Section 66 added do-not-disturb on the web, but the phone kept pinging and notifying, so it silenced one device and not the other.

**What.** The profile sheet (your avatar, top right) has a **Do not disturb** row under your status. Tapping it when it is off opens a sheet with the web's five choices (30 minutes, 1 hour, 4 hours, until 8:00 in the morning, until I turn it off); one tap switches it on and closes the sheet. When it is on the row's icon is red and it says "On, until 3:40 PM. Tap to turn it off."; tapping it then switches it off at once. Your avatar in the app bar gets a red dot, and its tooltip says so. While it is on the app makes no ping sound and shows no system notification, for DMs and @mentions. It is quiet, not blocked: messages still arrive and still count as unread. It ends by itself (the end time is checked where it is used).

**Same field as the web, so the two agree.** `users/{uid}.dnd = { until }` (`models/dnd.dart`; `utils/dnd.dart` for the choices, the end times and the wording, mirroring `dnd.js`). A missing or wrong-typed value is OFF, never on for ever; only an explicit null means "until I turn it off". Left out of the shared identity like `mutedChats` (nobody else's phone carries it). The write is `UsersRepository.setMyDnd`: the field, or `FieldValue.delete()` to switch off. **No rules change.**

**Where it silences.** The notification listener asks `_quiet` (do-not-disturb from the live profile, read at the moment a message arrives). The in-app ping goes through `dmPingDue(..., quiet:)`, and the system notification through `_fire`, which both DMs and mentions use. In both the message is recorded as seen BEFORE the check, so what arrived during do-not-disturb is not announced as new when it ends (the same order as the web).

**Wording differences from the web.** The time follows the phone's 12/24-hour setting (the web follows its own preference). A date further than tomorrow is written with English short names ("until Tue, Nov 17 9:00 AM").

**Checked.** 45 new Flutter tests (646 in all pass; `flutter analyze` clean): each choice's end, the morning at 3:00, 7:59, exactly 8:00 and 23:59 and across a month and a year; what a profile can hold (a number as a double, an explicit null, and 15 wrong shapes that must read as off); the exact moment it ends; the wording for today, tomorrow, further away and the same day of another month; the shared identity not carrying it; the row (off, on for ever, on until a time, run out, switching off, a failed switch-off); the sheet (what each choice writes, a second tap while writing, a failure and trying again, disabled look, and a tap that gets past it); 12-hour and 24-hour; the red dot; `dmPingDue` with and without `quiet`; and the listener, the profile sheet and the write pinned against their source (they cannot run in a widget test). 61 deliberate breakages: 57 caught the first time; 4 survived. One was equivalent (writing the morning as hour 8+24 gives the same date, because Dart rolls it over); two were guards that each hid the other (the code's busy check and the choices' disabled look) and are now tested separately; one was the phone's 12/24-hour setting, now tested. All caught after.

**NOT checked.** On a phone, either kind. **A real notification being suppressed, or the ping being silent**: the listener is pinned by its source, not run. Whether the red dot is clear on a 28 px avatar. **That the dot clears by itself**: it is worked out when the button builds, and it relies on your own profile being rewritten every 45 seconds while the app is open (the presence heartbeat, as on the web) to rebuild it; not measured here. Real Firestore (no fake exists, so the write is pinned against the web's). iOS. Two devices switching it at once (last write wins).

## 68. "Seen" in direct messages on the web (PR #75)

**Why.** Viber shows when the other person has read your message; the web showed nothing, so you could not tell "not read yet" from "ignored".

**What.** In a DM, under your latest message that the other person has opened, a small right-aligned line: **Seen 3:41 PM** (another day: "Seen Nov 12, 3:41 PM"; in your 12/24-hour choice). If you have sent a newer one they have not opened yet, the line stays on the last one they did. Only in DMs, not channels or notes. Preferences has a new **Privacy** section with **Let others see when I've read their messages**, on by default. It works both ways: turn it off and nothing about you is written, the receipts already written are removed, and you do not see theirs either.

**Why it is not built on `lastRead`.** "Mark as read" and "Mark all as read" also write `lastRead`, so "Seen" built on it would tell a sender you had seen something you never opened. So the open conversation writes its own `seen.<dm key>` (a server time) on your own profile, and only a DM, only while it is on screen and the tab is in use, only for something newer than the last receipt, and never in the oversight view. That check is separate from the unread one on purpose: a chat you had marked read from the sidebar and then opened still records that it was opened.

**How the other side reads it.** While a DM is open, one listener on the other person's profile document picks out `seen.<this DM>`. It goes through that document, not the shared user list, because `seen` is left out of everyone else's copy in `usersIdentity.js` (as `lastRead` is): it changes whenever its owner reads anything, and nobody's screen should redraw for it. A failure to read it is treated as "not seen", with no banner. The line is placed by `seenMarker` in `src/lib/seen.js`; a message of yours that is still being sent is never "seen".

**Rules: no change, and not deployed.** `seen` is a field of your own profile, which the general users rule already lets you write and nobody else, and every signed-in account can read. Seven new rules tests pin that so a tightening of the users rule cannot silently end "Seen": you can write and remove your own receipt, the other person can read it, nobody else can write or remove yours.

**Honest limit.** `lastRead` has always been readable by everyone signed in (the profile is the directory), so the switch controls what the app writes and shows, not what a determined person with database access could infer from `lastRead`.

**Checked.** 30 new Node tests, and 7 new rules tests run in the emulator (211 pass, 0 fail; 767 Node tests pass; the build passes). Two older tests that pin the read-marking effect's text were updated for its new call and dependency list; what they protect (waiting for the messages, running after the "New" line time is captured) is unchanged. Deliberate breakages in the web code: the first round of 71 left 10 alive; three checks that did nothing were deleted (the object check in `seenAtOf`, `seenAt > 0`, and skipping a message with no time), and the rest were real gaps, now tested (a text-only path check, an author-less message when nobody is signed in, the same day of another month, a channel being handed someone to watch). Then 63 plus 8 focused ones, all caught. Three deliberate changes to the rules (protecting `seen`, letting anyone update a profile, hiding profiles from others) each made the right new rules tests fail, and the rules file was restored.

**NOT checked.** In the real app: I cannot sign in here, and "Seen" needs two people, so the line, its position under a message, the two-way switch and a real receipt arriving were not seen. A real `seen.<key>` write with a server time against live Firestore (only the emulator). That the extra listener is cheap in practice: one document while a DM is open, but it fires on every change to that person's profile (including their 45-second presence update); the value is unchanged so nothing redraws, but this was not measured. Receipts exist only from now on: a message read before this shipped shows nothing. **The phone app** did not write a receipt or show the line when this shipped (section 69 adds both). How long after reading the line appears: the app waits 400 ms, then writes, then the other side hears it; not timed.

## 69. "Seen" in direct messages on the phone app (PR #76)

**Why.** Section 68 added "Seen" on the web, but the phone neither showed it nor recorded it, so a message read on a phone was never "Seen" for a web sender, and a phone sender never saw anything.

**What.** In a DM, under your latest message the other person has opened: a small right-aligned **Seen 3:41 PM** (another day: "Seen Nov 12, 3:41 PM"), in the phone's 12/24-hour setting; the same placement rule as the web. The profile sheet (your avatar) has a switch **Let others see when I've read their messages**, the same switch as the web's Preferences: off means nothing about you is written, receipts already written are removed, and you do not see theirs. Opening a DM on the phone now records a receipt that a web sender sees.

**Same field, same rules as the web** (`utils/seen.dart` mirrors `seen.js`): `seen.<dm key>` is a server time on your own profile. It is written in the SAME update as `lastRead`, and only when `shouldRecordSeen`: a DM, sharing on, **the app in front**, and something newer than your last receipt. "In front" is the phone's version of the web's "tab in use": a chat left open in a pocket has not been read. Marking read from the channel or DM lists never writes one. Coming back to the app with a chat open now records again (the app watches its own lifecycle), so what arrived meanwhile is seen when you look; that also re-marks the chat read, as the web does when its tab becomes active, which is a small change from before.

**The other side.** `peerSeenProvider`: one listener on the other person's profile document while the DM is open (`UsersRepository.listenPeerSeen`). A failure reads as "not seen". `seen` and `shareSeen` are yours alone: parsed on your profile, left out of the shared identity (no redraws when you open a chat). Only the DM screen passes someone to watch; a channel or My Notes watches nobody.

**The switch writes the web's preference.** `prefs.shareSeen` plus `prefs.updatedAt` (milliseconds): `updatedAt` is how the web tells a newer copy from an older one, so without it a web device would keep its own value. Turning it off also deletes `seen` in the same write. **Risk:** if the account has no `prefs` yet (nobody has changed a preference on the web), this creates `prefs: { shareSeen, updatedAt }` alone; the web then adopts that as newer and fills the rest with defaults. That is right for someone whose web preferences are the defaults, and would reset one whose non-default web preferences never reached the account (their sync failing); not tried.

**Checked.** 45 new Flutter tests (691 in all pass, `flutter analyze` clean): the path check, reading a receipt (a server time, a number, 12 kinds of nonsense), the decision to write (every combination, and in particular app not in front, not a DM, not sharing, nothing new), where the line goes (the same cases as the web), its wording, parsing your own `seen` and `shareSeen`, the shared identity carrying neither, the switch (on by default, off from the web, writes, a failure, nobody signed in), the line shown under exactly one message and nowhere else, and the controller, the chat, the repositories and the screens pinned against their source (they cannot run in a widget test). About 90 deliberate breakages: 80 in the first round, 3 survived (an empty user id, the sharing default, the 24-hour choice) and were closed with tests; then 7 more, all caught. One honest slip: a typo made the test file fail to compile during a repeat run, which makes every breakage look "caught"; that run was thrown away and repeated with the tests compiling.

**NOT checked.** On a phone, either kind, and with two real devices: the line, its look, a receipt crossing between web and phone, and the switch crossing to the web were not seen. **That the web adopts the phone's preference change**, and the risk above. How the app's lifecycle behaves in practice (locking the screen, switching apps, iOS versus Android): only the rule is tested, with a stand-in for the state. Real Firestore (no fake exists: the writes are pinned against the web's). That the extra listener is cheap (one document, fires on every change to that profile, including the 45-second presence update). Receipts exist only from now on.

## 70. Several pictures at once, with drag and drop, on the web (PR #77)

**Why.** The message box took one picture at a time, and only a drop onto the box itself. Sending four screenshots meant four rounds of attach, send, attach, send.

**What.**
- The **+** button picks several pictures at once; **paste** takes every picture on the clipboard; and you can **drag pictures onto the whole conversation** (not only the box): a "Drop to attach" cue covers it while they are over it.
- They wait in a **tray** above the box, one thumbnail each with its name, size and a remove button. Up to **10 at a time**, each under 10 MB, images only. Anything left out is said in one sentence ("1 file is not an image (only images for now); 1 image left out: at most 10 at a time.") and the rest is kept. The same file added twice is one.
- **One picture is one message.** A picture is stored inside its message document (there is no file storage) and a document holds about 1 MB, so two cannot share one. They go out **one after another, in the order chosen**; what you typed goes with the **first**, and only the first quotes the message you were replying to (`followUp` in `onSend`). While they go the box says "Uploading 2 of 5…".
- **If one fails**, the ones before it have gone, the typed text is spent (it went with the first), and the **rest stay in the tray** with "Sent 2 of 5. <reason>" so Send tries again from there. If the first fails, nothing is cleared.
- Switching conversation empties the tray (the pictures belong to the one they were chosen in), as it already did for one picture.

**Where.** `src/lib/attachments.js` (the rules and the sending, no browser needed), `src/components/AttachmentTray.jsx`, `Composer.jsx` (state, picker, paste, the drop zone), `ChatSurface.jsx` (the zone is its `<main>`; `followUp`). No change to the database, the rules, or the phone: each picture is an ordinary image message, which the phone already shows.

**Checked.** 33 new Node tests (800 in all pass; the build passes): which files are taken (type, 10 MB to the byte, duplicates, the ten limit counting what is already waiting, a bad file never using a place), drags that carry text or links (ignored), the clipboard, the order and the text-on-first rule, one at a time (the second does not start until the first is done), a failure at each position, progress, and the wiring pinned in the source. Four older tests that pin the box's text were updated. About 65 deliberate breakages: 4 survived the first round (the cue not coming down on a drop and on cleanup, and the progress wording) and were closed with tests. Then driven in a real browser with the real Composer (sign-in and the user list stubbed): a drop of three pictures and a text file (cue shown and gone, three thumbnails, the file refused with the message), dragged text ignored, removing one, a send with the second failing ("Uploading 1 of 2…", "Sent 1 of 2. network down", the unsent one kept, the text spent), the retry, pasting two pictures (pasted words untouched), and a drop of twelve (ten kept, "4 images left out").

**NOT checked.** In the real app (no sign-in here): a real send to Firestore, so the **order messages arrive in** is only as reliable as sequential `await`s (each waits for the previous write to be acknowledged, so it should be). Dragging from a real file manager or another browser (the test used synthetic drag events, which carry the same data but not the browser's own drag image); Safari and Firefox. Touch devices (drag and drop does not exist there; the picker and paste do the work). **Not done:** the phone's picker still takes one picture (`image_picker` multi-select is a separate change); there is no progress bar for a single large picture; a GIF or a voice message is still sent on its own.

## 71. Threads on the web (PR #78)

**Why.** A reply only quotes the message above it; to follow one question through a busy channel you scrolled and hunted. A thread gathers a message and everything said in reply to it in one place.

**No new data.** A reply has always carried `replyTo.messageId`. A thread is a message plus the messages whose `replyTo.messageId` is its id (`src/lib/threads.js`). So every reply ever sent, from the web, the phone or a bot, is already in a thread; nothing is stored, **the Firestore rules are not changed, and the phone is not touched**. Replies still appear in the conversation with their quote, as before: the thread is the same messages gathered, not hidden from the channel. Only **direct** replies belong to a thread; a reply to a reply starts a thread of its own, so a thread is flat.

**What.**
- A message with replies shows **N replies** under it (a small link); pressing it opens the thread. Any message has a toolbar button, **Start a thread** (or **Open thread** when it has replies).
- The thread opens as a **panel beside the conversation** (full screen on a phone-sized window): the message, how many replies, the replies oldest first, and a box **Reply in thread**. A reply written there is an ordinary message that quotes the first one (pictures, several at once and drag-and-drop work in it too; what is typed is kept per thread). Each reply has **Show in chat**. **Esc** or the × closes it; moving to another conversation closes it.
- In the read-only (oversight) view you can read a thread but not reply. Not offered in My Notes.
- The counts come from the messages already loaded (the same map is handed to the list while nothing changed, so a new message does not redraw every row). The panel reads **every** reply with its own query (`listenReplies`: `where('replyTo.messageId', '==', id)`, no ordering so no new index, capped at 200, sorted on the device).

**Not in the panel:** editing, deleting, reacting, a voice message's player (it says "Voice message"). Do those in the conversation ("Show in chat").

**Checked.** 28 new Node tests (828 pass) and 5 new rules tests in the emulator (216 pass): a member lists the replies in a channel and in a DM and gets only the right ones, someone outside the group or the DM is refused for both, and posting a thread reply is the ordinary message rule. The rules tests were failed on purpose by opening up read access on channel messages, then on DM messages: the new tests failed each time with the older ones. About 65 deliberate breakages of the logic and wiring: 12 survived the first round (3 redundant guards, deleted; the rest weak assertions: an ordering test whose ids matched the times, a null root with no non-reply in the list, pins that matched too loosely), all closed; the second full pass caught all 58 that still apply. The real `MessageList` and `ThreadPanel` were driven in a browser with the database replaced by an in-memory stand-in: "2 replies" on the right message only, the panel with the message and two replies, a reply sent from it updating both counts, quoting the message, and Esc closing it. Build: the main script grew from 331.4 to 334.7 kB (gzip 104.3 to 105.3 kB); the panel is a separate 4.4 kB part (1.9 kB gzip) loaded when a thread is first opened.

**NOT checked.** The real app (no sign-in here): a real query against Firestore from a browser (the rules test runs the same query shape in the emulator, but not through the app), real latency (the panel shows "Loading…" until the first answer). Two people in one thread. A thread with more than 200 replies (only the first 200 are read, in no particular order before sorting: the oldest are not guaranteed). The layout at tablet widths and with the member list open (the panel is 360 px beside the conversation; on narrow windows it covers it). Safari/Firefox. **Not done:** (the phone's thread view is section 72); (what is new in a thread, on the web, is section 76); no notifications per thread; no "reply count" on a message whose replies are older than the window (cannot happen: replies are newer than their message, and the window is the newest messages).

## 72. Threads on the phone (PR #79)

**Why.** Section 71 gave the web threads; the phone showed the same replies only as quotes. Now it has the same view, from the same data.

**No new data, no rules, no web change.** The phone reads exactly what the web reads: the messages whose `replyTo.messageId` is a message's id (`lib/utils/threads.dart` is a port of `src/lib/threads.js`, same rules: only direct replies, oldest first, a message still being sent last, at most 200). **The Firestore rules are not changed and nothing needs deploying.**

**What.**
- A message with replies shows **N replies** under it; pressing it opens the thread. The long-press menu has **Start a thread** (or **Open thread** when it has replies). Not offered in My Notes.
- The thread is a **screen of its own** (`lib/widgets/chat/thread_screen.dart`): the message, how many replies, the replies oldest first, **Show in chat** under each reply (closes the screen and scrolls the conversation to it), and a box **Reply in thread**. A reply written there is an ordinary message that quotes the first one; it does not touch whatever you were in the middle of replying to in the conversation. What is typed is kept per thread. The screen follows new replies down.
- The replies do **not** repeat their quote ("@Ana ...": it is always the message at the top); the message at the top keeps its own if it is itself a reply. The conversation still shows every quote.
- Reading and replying only, as on the web: no editing, deleting or reacting in the thread ("Show in chat" for those).
- The replies come from their own query (`MessagesRepository.listenReplies`: equality on `replyTo.messageId`, no ordering so no new index, capped at 200, sorted on the device), so a thread is complete even when the conversation is loaded only in part.

**Also changed (a small fix on the way).** The long-press menu used to list Reply, Edit, Delete and Pin even for a row that was given no way to do them (the tap did nothing); it now offers only what the row can do, and a row with nothing to offer opens no empty sheet. Every existing screen passes the handlers it always did, so nothing changes for them.

**Checked.** 71 new Flutter tests (762 in all pass, `flutter analyze` clean): the logic (ported from the web's tests), the count under a message (right message only, singular/plural, none where threads are not offered, updates when a reply arrives or goes), the menu entries (and each option on its own opening the menu), the thread screen (order, loading / empty / failed states, only this message's replies whatever the query returns, the message shown as it is now, a reply quoting the message and leaving the conversation's own reply alone, Show in chat, read-only, following new replies and not moving when one goes away, no repeated quote) and the repository, provider, controller and chat screen pinned against their source (they cannot run in a widget test). 80 deliberate breakages of the logic and the wiring, all caught; the three that first looked caught only by a compile error were repeated with a stricter check and are real catches. Two things found by reading the tests critically: a "no empty menu" test passed without proving anything, because its press missed the row (fixed: the tests now press on the author's name and a missed press fails the test), and one guard was redundant (editing needs text, text can be copied) and was removed rather than left untested. The screens were also drawn from the real widgets in a test at 390 px wide (dark theme, Roboto standing in for Inter) and looked at.

**NOT checked.** **No phone, no emulator, no Mac** (nothing here can run the app): the keyboard coming up in the thread's box, the back gesture, scrolling feel, the real font, light theme, a tablet, iOS. A real query against Firestore through the phone's plugin (the rules tests of section 71 run the same query shape in the emulator, not through Flutter). Real latency ("Loading..." until the first answer). Two people in one thread. A thread of more than 200 replies. **Observed (fixed in section 83):** in the test a press on the empty space to the right of a short message did not open the menu (only on the text, name or picture). **Not done:** unread counts or notifications per thread; (several pictures at once on the phone is section 73); sending from the thread to the conversation without a quote.

## 73. Several pictures at once on the phone (PR #80)

**Why.** The web (section 70) sends up to ten pictures in one go; the phone's picture button took one. Now it matches.

**No data, rules or web change.** A picture is still stored inside its message (no file storage, about 1 MB a document), so several pictures are **several messages**, in the order they were chosen, one after another. **The Firestore rules are not changed and nothing needs deploying.**

**What.**
- The picture button opens the gallery with several choosable (`pickMultiImage`). What is chosen shows as a **row of thumbnails** above the box, each with an **x** to take it back out (sideways, so ten take one line of the screen). Choosing again adds to them.
- The same limits and the same words as the web (`lib/utils/attachments.dart` mirrors `src/lib/attachments.js`): **ten at most**, **10 MB each**, the same picture chosen twice is one (the phone compares name and size; the web also uses the last-changed time, which the phone's picker does not give), and one sentence says what was left out ("2 images left out: at most 10 at a time.", "1 image is over 10 MB."). A picture that is too big or one too many never takes a place; nothing already chosen is ever dropped.
- Sending: **one message per picture**, in order; what was typed rides on the **first**, and so does the "replying to" quote (the chat clears it once a message has gone, so the rest do not repeat it). In a **thread** every picture quotes the thread's message, so all of them stay in the thread. While they go a line above the box says **Uploading 2 of 5...**, and adding or taking out is switched off.
- If one fails it stops there and says how far it got: **"Sent 1 of 3. ..."** plus the usual reason. The words went with the first, so once anything has gone they are spent; the pictures that did not go **stay** for another try (and go without words). If nothing went, everything is kept as it was.
- The old single-picture path is gone (the composer holds a list now). The gallery is a parameter of the composer (`pickImages`), so tests choose without one.

**Checked.** 60 new Flutter tests (822 in all pass, `flutter analyze` clean): the logic ported from the web's tests (ordering, duplicates, the size line exactly at 10 MB, the cap, which problem is reported when several apply, sending one by one and not before the last is done, stopping at the first failure, what is left, the words), and the box with a stand-in gallery (thumbnails in order, add, duplicate, cap and its sentence, too big, a gallery that cannot be opened, taking out one and only that one, a picture alone can be sent, several in order with words on the first only, send on and off, progress and everything locked while sending, each kind of failure: the first, a later one, the last, one picture alone, then trying again sends only the rest). About 63 deliberate breakages: 60 caught first time, 3 survived: one is not a real difference (a plural of "0 images" that the code never asks for), and two were holes in my tests (the "tray is empty after" checks used a text finder that cannot see the tray's label, so they proved nothing; and nothing pressed send while it was already sending): both fixed and caught on a repeat. One redundant condition ("more than one picture" before "Sent N of M": a single picture that failed has nothing sent before it) was removed rather than left untested. Presses that land on nothing now fail the tests instead of passing.

**NOT checked.** **No phone, emulator or Mac**: the real gallery (what it returns for HEIC or very large photos, the permission prompt, iOS "selected photos", how many Android's photo picker lets you choose), memory with ten photos loaded at once (each is read whole into memory before it is shrunk for sending), the look and feel of the thumbnail row and the x targets (32 px), the uploading line on a slow connection, real failure in the middle of a batch, the light theme, tablets. **Not done:** drag and drop and paste do not exist on a phone; a camera shortcut; unread counts or notifications per thread.

## 74. Search with filters, on the web (PR #81)

**Why.** "Search this chat" looked for a word and nothing else. Finding "the picture Ana sent last week" or "my messages with a link" meant scrolling the results by eye.

**No data, rules or phone change.** It filters the messages already loaded, as before (**still only the loaded part of the conversation**, newest first, at most 100), so nothing is read or stored differently and **nothing needs deploying**. The phone is not touched yet (it has its own search sheet).

**What.** Words and filters mix in the one box (`src/lib/searchFilters.js`):
- `from:ana` (any part of the name; the name as it is now, else the one on the message), `from:me`; `mentions:ana`, `mentions:me`
- `has:image` (also voice, link, reply), `is:pinned` (also edited)
- `before:2026-11-01`, `after:2026-11-01`, `on:2026-11-01`
- A value with spaces goes in quotes (`from:"Ana Reyes"`). Different filters all have to hold; `from:`/`mentions:` given twice is "either"; `has:` twice is "both".
- **before / after are the days before / after that day** (the day itself is not in either); `on:` is that day, all of it. Days are the reader's own time zone, by calendar day (a 25-hour or 23-hour day at a clock change is still one day).
- Five buttons under the box (Pictures, Voice, Links, Replies, Pinned) put a filter in the box or take it out; the box is the one source of truth, so they and typing agree. The empty box lists what can be typed.
- A filter alone is a search (no words needed). A piece that cannot be used (`has:banana`, `before:2026-13-45`) is **said in one line and left out of the search**, not turned into words that match nothing. `from:` with nothing after it yet is ignored (it is being typed). Something that only looks like a filter ("https://x", "re:hi", "info:x") stays a word.
- A result with no words (a picture, a voice message) says "Picture" / "Voice message" instead of an empty line; only the words are highlighted, not the filters.
- **The search box is now a lazy part** (loads when first opened): the main script went from 334.72 kB (105.25 gzip) to 332.10 kB (104.55 gzip), and the search box and its filters are a separate 7.41 kB (2.99 gzip) part.

**Checked.** 60 new Node tests (888 pass): taking a query apart (every filter, case, quotes, words that only look like filters, empty and half-typed pieces, duplicates, every kind of bad value), each filter's rule at its edges (a day's first and last second, the end of a month and a year, a leap day, exactly the limit, a pending message with no day), **a real daylight-saving time zone** (New York's 25-hour and 23-hour days, with a check that the zone change took effect), the order and cap of results, the buttons, and the box, chat screen and lazy part pinned against their source. **115 deliberate breakages: 114 caught.** The first run caught 101 of 112 (7 survived, 4 could not be applied because my search text did not match); the survivors were holes in my tests (nothing searched for `from:me` through the real search; the match count line was not pinned; `is:` twice; the 24-hour-day shortcut only differs on a clock change) or two checks that were redundant (a month that does not exist already changes the year or the day), which I removed rather than left untested. The one that still survives is not a real difference (a time that is not a number already fails every comparison). The real search box was also driven in a browser: typing `release from:me` found only my two messages with "release", a button put `has:image` in the box and took it out, a bad date was explained and ignored, `from:ben after:2026-11-04` found the right two (a voice message among them), pressing a result jumped to it, and the console stayed clean.

**NOT checked.** The real app (no sign-in here): the box inside the real chat header, how it looks next to the pinned list on a narrow window, Safari/Firefox. A conversation with more than the loaded messages: filters only see what is loaded (older messages need "load more" first), and the box says so only as before. Names with accents or other alphabets (matching is plain lower-casing, not accent-insensitive). `from:` matches a part of a name, so `from:an` finds Ana and Ian. **Not done:** (the phone's search sheet is section 75); searching across channels; a person picker for `from:`.

## 75. Search with filters, on the phone (PR #82)

**Why.** Section 74 gave the web search filters; the phone's "Search this chat" still looked for a word and nothing else. Now it matches.

**No data, rules or web change.** It filters the messages the chat has already loaded, as before (**still only the loaded part of the conversation**, newest first, at most 100), so nothing is read or stored differently and **nothing needs deploying**.

**What.** The same filters, the same rules and the same wording as the web (`lib/utils/search_filters.dart` mirrors `src/lib/searchFilters.js`; see section 74 for the full list): `from:` / `from:me`, `mentions:` / `mentions:me`, `has:image|voice|link|reply`, `is:pinned|edited`, `before:` / `after:` / `on:` with a day like `2026-11-01`, quotes for values with spaces; before / after are the days before / after that day, `on:` is that day; days are in the phone's own time zone, by calendar day.
- Five buttons under the box (**Pictures, Voice, Links, Replies, Pinned**) put a filter in the box or take it out; the box is the one source of truth, so the buttons and typing agree. They sit in one sideways row.
- A filter alone is a search. A piece that cannot be used (`has:banana`, `before:2026-13-45`) is **said in one line and left out**, not turned into words that match nothing. The empty box lists what can be typed.
- A result with no words says "Picture" / "Voice message".
- The chat tells the sheet who is searching (for `from:me` and `mentions:me`).
- One difference from the web, on purpose: the function is called `messageMatches` here because `matches` is already a name in the test framework. And a year before 100 is turned down (as the web does by accident: its Date reads 0-99 as 19xx).

**Checked.** 73 new Flutter tests (895 in all pass, `flutter analyze` clean): the logic ported from the web's tests (54: taking a query apart, each filter at its edges, a day's first and last second, month and year ends, a leap day, a message not sent yet, result order and cap, the buttons), and the real sheet (19: the buttons, typing and pressing agreeing, each button finding what it says, dates, a bad piece explained and ignored, no matches, a result jumping to its message and closing the sheet, "from:me" with and without knowing who you are). **109 deliberate breakages, all caught** (none by a compile error). Presses that land on nothing fail the tests instead of passing; a first draft had the buttons in a lazy list, so the fifth did not exist until scrolled to, which the tests exposed: they are now a plain row.

**NOT checked.** **No phone, emulator or Mac**: how the sheet looks and scrolls on a real screen, the keyboard over the sheet, the button row on a narrow phone (it scrolls sideways; whether people find the fifth), light theme. **Daylight-saving days:** the web has a test in a real DST time zone; Flutter tests cannot change the machine's time zone, so here "the next day" is built from the calendar date (pinned in the source, `DateTime(d.year, d.month, d.day + 1)`), not tested on a 23- or 25-hour day. Filters only see loaded messages. Matching is plain lower-casing, not accent-insensitive, and `from:` matches part of a name (`from:an` finds Ana and Ian). **Not done:** searching across channels; a person picker for `from:`; the web's highlighting of the matched words (the phone never had it).

## 76. What is new in a thread, on the web (PR #83)

**Why.** A message with replies said "N replies", and nothing more. Coming back to a busy channel you could not tell which threads had something you had not seen without opening each one.

**No data, rules, storage or phone change.** Nothing new is stored, anywhere. **The Firestore rules are not changed and nothing needs deploying.** The phone does not have it yet.

**What.** The "N replies" under a message gets a small pill, **"2 new"**, when some of its replies are new to you. A reply is **new in its thread** when it is **from someone else**, was sent **after the last time the conversation was read before you opened it** (the same moment the "New" line is drawn from: `readAtEntry`), and **after the last time you had that thread open** during this visit. Opening a thread (the panel) marks it seen up to its newest reply, as the panel's replies change, so replies that arrive while it is open are not "new". A reply of your own is never new; a reply still being sent has no time and is not counted.
- Like the "New" line, when your last-read time is not known (never read, a read-only look, notes) **nothing is new**: a new member of a channel is not told every old thread is new.
- Counted from the messages already loaded (the same ones "N replies" is counted from), so a reply older than the loaded window is not counted. Kept as the SAME map while nothing moved, so a message arriving redraws only the rows whose count changed.
- A conversation opened again starts clean: its own last-read time at that opening, and no thread seen. **"Seen" lives only in the open page**, so reloading the page forgets which threads you looked at this visit; what you had read still counts through the last-read time.
- The conversation list's own unread dot is unchanged (a reply is a message, so it already counted).

**Checked.** 29 new Node tests (917 pass): each rule of what is new (strictly after, per message, the later of the two times, your own, pending, not a reply, a reply to itself, times as numbers or server times, unknown last-read times of every kind), marking a thread seen (newest reply, never backwards, the SAME object when nothing moves, other threads untouched, nothing recorded for pending replies), a full cycle (seen, then a later reply is new again), and the chat, the panel and the list pinned against their source. **42 deliberate breakages: 38 caught.** 4 survive, and they are not real differences: explicit "no time yet" guards that JavaScript's own comparison would also handle (`null` never compares after anything, a time-less reply leaves "newest" empty), and a non-finite last-read time that already fails every comparison; kept because the guards say what is meant. A redundant `typeof` check was removed. The real `MessageList` was driven in a browser with the chat's state stood in for: "2 replies" with "1 new" on the right message only (not on a message whose only reply is mine); another reply arriving made it "2 new", my own reply did not; opening the thread cleared it; the next reply from someone else made it "1 new" again (a first try with replies whose times went backwards showed nothing new, which is the harness's mistake: times from the server only go forward). Main script 332.10 -> 333.26 kB (gzip 104.55 -> 104.94).

**NOT checked.** The real app (no sign-in here): the real panel marking seen through a real query (the list and the pure logic were checked, the panel -> chat wiring is pinned against its source, not run), two people in one thread, the pill on a narrow window. Replies older than the loaded window, and the 200-reply limit of the panel (it marks seen up to the newest of what it loaded). A device clock far off does not matter (everything compares server times). **Not done:** (the phone is section 77); notifications per thread; a "New" line inside the thread panel; remembering which threads you read across reloads (that would need to be stored somewhere).

## 77. What is new in a thread, on the phone (PR #84)

**Why.** Section 76 gave the web a "2 new" pill on a message's "N replies"; the phone showed the count and nothing more. Now it matches.

**No data, rules, storage or web change.** Nothing new is stored: the "seen" times live in the open chat screen. **The Firestore rules are not changed and nothing needs deploying.**

**What.** The same rule as the web (`lib/utils/threads.dart` mirrors `src/lib/threads.js`: `newReplyCounts`, `markThreadSeen`): a reply is **new in its thread** when it is from someone else, was sent after the last time the conversation was read before it was opened (the moment the "New" line is drawn from), and after the last time that thread was open on this screen. Your own replies and replies still being sent are never new; when the last-read time is not known, nothing is new. The "N replies" chip gets a small **"2 new"** pill beside the count. Opening a thread (its screen) marks it seen up to its newest reply, as its replies change; the conversation is told after the frame (never while building), and only when the newest time moved forward (a reply going away cannot make a thread unseen). A conversation opened again starts clean.

**Also changed (a gap from section 72).** The "N replies" chip is now **its own button for a screen reader** (its own accessibility node that carries the tap). Before, it merged into the message's node and was not offered as a button; the label now includes the new ones ("3 replies, 2 new, open the thread").

**Checked.** 40 new Flutter tests (935 in all pass, `flutter analyze` clean): the logic ported from the web's tests (every rule of what is new, marking seen, the full cycle), the pill on the row (and not without a count or a way to open it; pressing it opens the thread; the chip is a button with a tap action), the real list (the right message only, from others only, an earlier last-read time, seen up to what was seen, nothing without a last-read time, following a thread being looked at, a reply arriving, and the last-read time changing), the thread screen reporting what it shows (once replies are in, again for a newer reply, not on a rebuild, not when a reply goes, not for replies with no time), and the chat, list and screen pinned against their source. **51 deliberate breakages, all caught** (none by a compile error). One thing the tests found: the first version reported again when a reply went away; it now only reports a newer time.

**NOT checked.** **No phone, emulator or Mac**: how the pill looks on a real screen and at large text sizes, TalkBack and VoiceOver reading the chip (the node and its label are tested, not heard), a real thread open while someone else replies. Replies older than the loaded window are not counted (as on the web). "Seen" lives in the open screen, so leaving the chat forgets which threads were looked at; what was read still counts through the last-read time. **Not done:** notifications per thread; a "New" line inside the thread screen.

## 78. Spoilers on the web (PR #85)

**Why.** Discord's `||text||`: hide the ending of a film, an answer, a surprise, until someone chooses to look.

**No data, rules or Worker change; the phone is not done yet (next PR).** The message is stored **as typed**, so `||like this||` is what is in the database. **The Firestore rules are not changed and nothing needs deploying.** An older client (or the phone until its PR) just shows the bars.

**What.**
- `||text||` is drawn as a bar, with the text hidden, until it is **pressed** (or Enter / Space on it): then the text shows **for good** (as on Discord). Each spoiler is its own: two in one line are pressed separately. What is inside is drawn like any other text first (bold, emoji, mentions, code, links), then hidden: nothing inside shows through (a mention, code, an emoji and a link have colours, borders and pictures of their own, all made invisible), and **a link inside cannot be clicked before the text is shown**.
- It is a spoiler only when the bars **touch the words on both sides**: `a || b || c`, `x || y`, `if (a || b)` and `||||` are not, so code and tables are safe. No bar or line break inside.
- For a **screen reader** a hidden spoiler is a button, "Spoiler, press to show", and what is behind it is not read out.
- **It stays hidden wherever text is shown as plain text** instead of drawn by the renderer: the quote in a reply (hidden when written, and again when shown, so an older client's quote is hidden too), the "replying to" bar in the box, search results, the pinned list, the forward box's preview, the conversation preview written to a DM, and **notifications** (a DM's and a mention's). There the spoiler reads **"[spoiler]"**. Copying a message still copies what was written, and forwarding sends the original, spoiler and all.
- The bar is a **theme colour** (the same grey as dim text), so it works in the light and dark themes.
- Behind it: `src/lib/spoilers.js` (the pattern, `hideSpoilers`), and `src/lib/inlineTokens.js`, which now finds the pieces of a message (code, bold, strike, italic, links, emoji, mentions, spoilers) in one pass and in a fixed order. The renderer used to do this with one expression that it shared with itself, which could not be used inside a spoiler; the pieces can now be tested without a screen, and the phone has the same list.

**Checked.** 36 new Node tests (953 pass): what is and is not a spoiler (every edge: spaces inside, empty, a bar or line break inside, the whole piece), hiding it as plain text (and that it is idempotent, that things which only look like spoilers are left alone, that non-text comes back as it was, that the same pattern used again and again does not remember where it stopped), finding it among the other pieces (the ORDER of the kinds, code wins where it starts first, links and bold beside it, the pieces cover the text exactly once, no memory between calls), and every place that shows plain text, the renderer, the button and the style, pinned against their source. **52 deliberate breakages: 51 caught.** The first run caught 48 of 53; the survivors were holes in my tests (a list that turns into text passing as text; no test with upper-case links or emoji, which is what the `i` flag is for) and a redundant `!text` guard, which I removed. The one left is not a real difference (the inside of a spoiler cannot contain a bar, so greedy and lazy matching find the same). The real renderer was driven in a browser: hidden bars in both themes; a click, Enter and Space each showed the right one only; another key did nothing; a rich spoiler (bold, emoji, mention, code, link) was fully invisible and its link not clickable; the non-spoiler lines and the code sample were untouched. Main script 333.26 -> 334.54 kB (gzip 104.94 -> 105.42).

**NOT checked.** The real app (no sign-in here): the bar inside the real message list and on a long line that wraps (it is an inline element, so a wrapped one is a bar on each line; not looked at), selecting and copying hidden text by dragging across it (the text is there, just transparent, as on any such page), the real notification text. **A spoiler in a search result is found by what is inside it** (the result says "[spoiler]", but searching "butler" finds the message): that tells the searcher a word is in there. Nesting (`**||x||**`) is not drawn as a spoiler (the bold wins, and the bars show). **Not done:** (the phone is section 79); a button or shortcut to wrap the selection in `||`; hiding a picture as a spoiler.

## 79. Spoilers on the phone (PR #86)

**Why.** Section 78 gave the web `||text||` spoilers; on the phone they showed as bars of text. Now they match.

**No data, rules or Worker change.** The message is stored as typed. **The Firestore rules are not changed and nothing needs deploying.**

**What.** The same rules as the web (`lib/utils/spoilers.dart` mirrors `src/lib/spoilers.js`; the piece list in `lib/markdown/message_parser.dart` is in the same order as `src/lib/inlineTokens.js`, spoilers last):
- `||text||` is a **bar until it is tapped**, then the text for good. Each spoiler is its own. What is inside is parsed like any text (bold, emoji, mentions, code, links) and hidden with it: laid out (so the bar is as wide as the text) but not painted and **not touchable**, so a link inside cannot be opened before the text is shown. An emoji inside keeps its size. A long one wraps inside its bar.
- It is a spoiler only when the bars **touch the words on both sides**: `a || b || c`, `x || y` and `||||` are not; code keeps its bars.
- For a **screen reader** it is a button, "Spoiler, press to show" (its own node, with a tap action), and what is behind it is not read.
- **Hidden wherever text is shown as plain text** (reads "[spoiler]"): the reply quote (when written, and again when shown, so an older client's quote is hidden too), the "replying to" bar and the pinned list (both through `ChatMessage.previewText`), search results, the preview of a forward, the conversation preview written to a DM (`lastMessageText`), and a DM **notification**. Copying a message still copies what was written, and forwarding sends the original.

**Checked.** 42 new Flutter tests (977 in all pass on a full run, `flutter analyze` clean): the logic ported from the web's tests (what is and is not a spoiler, hiding, the pieces and their order, what is inside held as pieces), the real widget (hidden until pressed, pressed for good, each one its own, bold and mention inside hidden then shown, a link inside not pressable, a screen reader finding a button and pressing it and not reading the text, things that only look like spoilers left alone, code, a long one, an emoji's size), every plain-text place (the reply strip, preview, forward preview, pinned list, search results) and the repository, notification and parser pinned against their source. **34 deliberate breakages, all caught.** The first run caught 34 of 36: the two survivors were redundant accessibility code (a fully transparent layer is already left out of what a screen reader reads, and the tap already comes from the gesture detector; both removed) and a missing test (an emoji inside keeping its size; added).

**One flaky test, seen once (fixed in section 80).** In one of three full runs, `test/providers/presence_store_test.dart` ("20 heartbeats rebuild the directory zero times; a rename rebuilds it once") failed; it passed on its own and in the next full run. It does not touch anything changed here; it looks timing-sensitive under load. **Not investigated.**

**NOT checked.** **No phone, emulator or Mac**: how the bar looks and wraps at large text sizes and in the light theme, TalkBack / VoiceOver actually reading it (the node, label and tap are tested, not heard), selecting hidden text (it is not painted, so there is nothing to select). Searching finds a message by what is inside a spoiler (the result says "[spoiler]"). Nesting such as `**||x||**` is not drawn as a spoiler (the bold wins and the bars show). **Not done:** (a button or shortcut to wrap the selected text in `||`: on the web, section 81; on the phone, not yet); hiding a picture as a spoiler.

## 80. A flaky presence test, found and fixed (PR #87)

**What.** While adding spoilers (section 79), one full test run failed in `test/providers/presence_store_test.dart` ("20 heartbeats rebuild the directory zero times; a rename rebuilds it once"); it passed alone and on the next run. It is a **test timing problem, not an app bug**, and it could have blocked a merge at any time (CI machines are busier than this one).

**Reproduced, then explained.** Run in a loop while eight processes kept the CPU busy: **2 failures in 8**. The test waited a fixed 10 ms (`settle()`) for the first load to reach the directory AND the list, then counted rebuilds. On a busy machine the list's rebuild landed a moment after the count was taken (the failure read `Expected (1, 0), Actual (1, 1)`), so the 20 heartbeats got the blame for a rebuild that belonged to the first load. Another test checked "not published yet" 10 ms into a 70 ms batching window, which a slow machine can overrun the other way.

**Fix (tests only; the app is unchanged).** The tests now **wait for what they need** (`until(...)`, which fails saying what it waited for instead of hanging) instead of for fixed times, and the batching window in these tests is **400 ms** (was 70), so "not yet published" is not a race. The test names and what they check are the same.

**Checked.** The same load that failed 2 of 8 runs: **0 failures in 16**. The full Flutter suite passes (977), `flutter analyze` clean. The tests still guard the behaviour: with the app deliberately broken (every snapshot rebuilds the directory) they fail, reading `Expected (1, 1), Actual (21, 21)` and the heartbeat time published early.

**NOT checked.** A busier or slower machine than this one (the load here was eight busy processes; GitHub's runners were not tried). Other tests in the project that wait a fixed few milliseconds for something to propagate (`await Future.delayed(...)`, `pump(Duration(...))`): none has been seen to fail, and I did not hunt for them.

## 81. Formatting the selected text, on the web (PR #88)

**Why.** Bold, italic, strikethrough, code and spoilers are all in the message text as marks (`**`, `_`, `~~`, `` ` ``, `||`), but the box gave no help writing them: you had to type the marks by hand, on both sides, with no mistakes. Spoilers (section 78) in particular are not something people will type from memory.

**No data, rules or Worker change; the phone is not done yet.** The message text is the same as before (what is written is what is stored). **Nothing needs deploying.**

**What.**
- **Ctrl/Cmd+B** makes the selected text bold and **Ctrl/Cmd+I** italic (only those two keys: they are what everyone expects and do not clash with what a browser keeps for itself; not with Alt or Shift held, nor while an input method is composing). Both are listed in the keyboard shortcuts sheet ("Writing").
- An **"Aa" button** in the box opens a row of five buttons above it: **Bold, Italic, Strikethrough, Code, Spoiler**. A button works on the selection and **does not take the selection out of the box**, so it can be pressed again.
- **Pressing it again takes the formatting off**, also from several formats at once: select words that are bold and italic (`**_words_**`), press Bold, and only the bold goes (`_words_`). After each press the selection is on the same words.
- **Spaces at the ends of the selection stay outside the marks** (a spoiler cannot start or end with a space: selecting " secret " gives " ||secret|| ").
- **Nothing selected**: the pair of marks goes in at the cursor, the cursor between them; pressed again between an empty pair, it takes the pair away (a selected empty pair too).
- **Several lines selected**: marked line by line, since the marks cannot cross a line break.
- Italic uses `_`, not `*`, so it can never be mistaken for half of a `**bold**`. Nothing is written by a button that the renderer would not read back as that format (a test checks each).
- Behind it: `src/lib/formatting.js` (pure: text and selection in, text and selection out), `src/components/FormatBar.jsx`.

**Checked.** 53 new Node tests (1006 pass): each format's marks (read back through the renderer's own tokenizer), the keys (and the ones that must not work), wrapping and toggling for every format, the edge cases (spaces, empty and selected-empty pairs, several lines, empty lines, a selection that ends mid-line before a line break, backwards and out-of-range selections, text that is not text, an unknown format, emoji, mentions), layered formats taken off one by one, marks on ONE side only (nothing is cut), and the box, the bar and the shortcuts sheet pinned against their source. **73 deliberate breakages, all caught.** The first run caught 64 of 77; the survivors were: tests missing for cases where a wrong answer would CUT text (marks on one side only, a selection ending mid-line), a few redundant conditions (removed), and one **real bug the layered test found: after Bold then Italic, pressing Bold again wrapped the words in more bold; it now looks outward through other formats' marks.** One mistake of mine, caught by the mutations: while removing a wrong test I deleted a whole section of tests with it; the mutations that section should have caught survived, which is how I noticed, and it is restored. The real box was driven in a browser with real key presses and a real click: Ctrl+B made the word bold and put the selection back on it, again took it off, Ctrl+I added italic, Ctrl+B took only the bold off and left the italic; the toolbar opened with its five buttons, pressing Spoiler wrapped the selected word with the selection and focus kept; sending showed the italic word and a hidden spoiler. Main script 334.54 -> 338.76 kB (gzip 105.42 -> 107.01; the box is not loaded on demand).

**NOT checked.** The real app (no sign-in here): the row inside the real conversation layout and on a narrow window, Safari/Firefox (a browser may keep Ctrl/Cmd+B or +I for itself in some contexts; the box asks it not to), the shortcut on non-English keyboards (it follows the character typed, not the key's position). **Known limits:** selecting text that already contains the SAME mark in its middle (`**a** b **c**` as one selection) wraps it again instead of removing the inner marks; select the words to change. Whether the buttons should remember being open across conversations (they close with the page). **Not done:** (the phone is section 82); a shortcut for code, strikethrough and spoiler (they are on the buttons only); turning `*italic*` typed by hand into the `_` form.

## 82. Formatting the selected text, on the phone (PR #89)

**Why.** Section 81 gave the web a way to write bold, italic, strikethrough, code and spoiler without typing the marks by hand; on the phone nothing helped, and a spoiler's bars are awkward to type on a phone keyboard.

**No data, rules, Worker or web change.** The message text is the same (what is written is what is stored). **Nothing needs deploying.**

**What.**
- A small **"Aa" icon inside the message box** opens a row of five buttons above it: **Bold, Italic, Strikethrough, Code, Spoiler** (`lib/widgets/chat/format_bar.dart`). The row is shut to begin with and the icon turns the brand colour while it is open.
- The same behaviour as the web, because `lib/utils/formatting.dart` is a case-by-case port of `src/lib/formatting.js`: a button works on the selection and **keeps it** (on the same words), so **pressing again takes the formatting off**, also one of several layers (`**_words_**` → Bold → `_words_`); **spaces at the ends of a selection stay outside the marks** (so a spoiler is a spoiler); with **nothing selected** the pair of marks goes in at the cursor with the cursor between them (between an empty pair, pressing again takes the pair away); **several lines** are marked line by line; italic is `_`, so never half of a `**bold**`. A box that has never had a selection formats at its end.
- **The box keeps its focus** (so the keyboard stays and typing goes on), the send button learns the box now has text, and the buttons are **off while a message is going out**.
- The selection offsets are UTF-16 code units, the same as the text box counts them and as the web's.

**Checked.** 59 new Flutter tests (1036 in all pass, `flutter analyze` clean): the logic ported case by case from the web's tests (40: wrapping and toggling for every format, layers, spaces, empty and selected-empty pairs, several lines, a selection that ends mid-line, marks on one side only so nothing is cut, a selection given backwards or out of range or with no selection at all, unknown format, accents, emoji, mentions; and what each format writes is read back by the message parser as that format), and the real composer (19: the row opens and shuts, five buttons in order, each with a picture and a name, each button writes its own marks, bold then italic then bold again, spaces, nothing selected, a box never selected, several lines, focus kept, what is written is what is sent, the send button, off while sending, and the wiring pinned against its source). **61 deliberate breakages, all caught** (none by a compile error: one first drew a compile error and was redone as a valid breakage). The first run caught 60: the survivor was a button with no picture, which no test would have noticed; there is a test now.

**NOT checked.** **No phone, emulator or Mac**: the real touch selection handles (the tests set the selection directly; dragging the handles, a long press to select a word, and then pressing a button while the keyboard is up were not tried), whether pressing a button keeps the keyboard open on every phone, how the "Aa" icon looks inside the box and the row at large text sizes and in the light theme, TalkBack / VoiceOver reading the buttons (they have names; not heard). On the narrowest phones the row of five buttons is as wide as the screen. **Known limit** (as on the web): a selection that already holds the same mark in its middle is wrapped again rather than cleaned. **Not done:** remembering the row open between conversations; a hardware-keyboard shortcut (there is no such thing on the phone's box); the web's Ctrl/Cmd+B / +I.

## 83. A press anywhere on a message row opens its menu, on the phone (PR #90)

**Why.** Section 72 noted, and left, something seen while testing: on the phone, **a long press on the empty space beside a short message did nothing**. Only the text, the name or a picture answered. A short message is mostly empty space, and a thumb does not aim for the letters; the menu (Reply, React, Start a thread, Copy, Forward, Save, Pin, Edit, Delete) felt unreliable.

**No data, rules, Worker or web change.** One property of the row. **Nothing needs deploying.**

**What.** The message row's press handler is now **opaque** (`HitTestBehavior.opaque`): the whole row, edge to edge (empty space to the right, the gap under the avatar, the strip above and below the lines), opens the menu on a long press. Taps on what is inside the row (a link, a picture, a reaction, the "N replies" chip, the quote of a reply) work as before: those are different gestures and the row's handler is only a long press.

**Checked.** Reproduced first: a test that long-presses the empty right-hand side of a short message, the left edge under an avatar and the top-right corner failed on the old code (and the press on the text passed); it passes with the change. 5 new Flutter tests (1041 in all pass, `flutter analyze` clean): the press on the text, on the empty right, on the left edge, in the corner, and the property pinned against its source. 3 deliberate breakages (opaque removed, set back to "defer to child", the press made to do nothing), all caught; the existing tests of the row's menu, the chip and the other taps all still pass.

**Measured, not changed.** The × on a picture waiting to be sent has a touch box of **40 x 40** (its picture is 24): a little under the 48 that is recommended. A bigger target would sit over the corner of the picture and make the button look wrong, so it is left; it should be tried on a real phone.

**NOT checked.** **No phone, emulator or Mac**: a long press on a real thumb (the tests press at positions), pressing on the empty space of a row that is part of a long run by the same person (the same code), a very long message that wraps (the whole row is the target, as before for the text). A long press on a link inside a message (the link's own handling, unchanged).

## 84. Large text on a small phone: four screens that overflowed (PR #91)

**Why.** Everything added in sections 72–83 had been looked at at a normal size only. Android's "largest text" setting (2x) on a 320-wide phone is real, and a Flutter overflow is a yellow-and-black stripe or a button pushed off the screen. So this one is an audit: the new screens were drawn at **320x568 with text 2.0x**, **360x640 with 1.3x** and **320x568 with 1.0x**, and anything that overflowed or threw was a failure.

**No data, rules, Worker or web change.** Layout only. **Nothing needs deploying.**

**Found and fixed (4).**
- **The quote above a reply** (`_ReplyStrip`): the author's name was a `Text` that could not shrink, so a long name pushed the row off the screen (this one was older than the threads work). Name and quote are now one line of rich text, cut with an ellipsis at the end.
- **The "N replies" chip with its "new" pill**: a `Row`, wider than the screen at 2x with a count of 128 and 99 new. It is a `Wrap` now: the pill goes on to the next line.
- **The message box**: with a reply bar, ten pictures, an error and the format row all open, it grew **356 px past** the bottom of a small screen. The status lines (reply bar, pictures, progress, error) now **scroll inside 30% of the screen that is left** (keyboard excluded), and the text field is as many lines tall as fit in 25% of it (2 to 6, was always up to 6).
- **The search sheet**: the notes about a bad filter piece, the "N matches" line and the hint were above the list and, at 2x, taller than the sheet (**126 px** over). They are now the first items **in** the list, so they scroll with the results.

**Not a problem (looked at, clean):** the thread screen, the formatting row, spoilers/code/mentions in a message, and the message list with threads.

**Checked.** 21 new Flutter tests (7 screens x 3 sizes; 1062 in all pass, `flutter analyze` clean). The first run failed 5 of the 21 (the four above; the strip showed up first). 5 deliberate breakages: chip back to a `Row`, status area not capped, text field always 6 lines, search notes taken out of the list: **all caught**; the 5th (`Expanded` -> `Flexible` in the quote strip) survives and is equivalent as far as overflow goes (the text is cut either way). Two of them first **survived**: the test never typed enough lines to reach the field's cap, and nothing checked that the search notes were still there; there are assertions for both now (the field is at most 40% of the screen after 20 lines; both notes, the count and the last result are reachable). Two existing tests looked for the quote's name and text as two separate widgets (`find.text('@Ana')`); they look at the combined text now.

**NOT checked.** **No phone, emulator or Mac**: a real "largest text" setting, the real keyboard (the box's share is worked out from the keyboard's height, but the tests never raise a keyboard), landscape, a tablet, and the screens that were not part of this stretch's work (the audit covers only what sections 72–83 added). Left alone: a chip that wraps is two lines tall, which is more than the 40 px press target of one line (it only gets taller).

## 85. The words searched for are marked in the results, on the phone (PR #92)

**Why.** The web's search marks the words you typed inside each result; the phone's sheet never did (sections 75 and 74 listed it as "not done"). On a phone, with three lines of a long message per result, finding why a message matched is the whole point.

**No data, rules, Worker or web change.** Drawing only. **Nothing needs deploying.**

**What.** `lib/utils/highlight.dart` (`highlightParts`, a port of `highlight()` in `SearchDropdown.jsx`) cuts a text into the stretches that match and those between; the result's text is drawn as rich text with a warning-coloured background behind each match (`Palette.warn` at 30%, the same as the web's `bg-warn/30`). It marks the **words** only (`parsed.text`), never a filter such as `from:ben`; capitals do not matter and the text keeps its own; every match is marked; the text it marks is the same one shown (so a spoiler is "[spoiler]" and nothing in it is marked, which also keeps the hidden words from being given away); a result with no words (a picture or a voice message) has nothing to mark. A search with only filters marks nothing.

**Checked.** 13 new Flutter tests (1075 in all pass, `flutter analyze` clean): the cutting (order, start and end, adjacent and non-overlapping matches, capitals, no query or no text, joining gives the text back, characters that are special in patterns, emoji and accents), and in the real sheet (marked in every result whatever the capitals, several matches in one result, filters-only marks nothing, the text still reads whole). **11 deliberate breakages of 12 caught** (none by a compile error): the survivor cut a result to one line instead of three, which no test of the sheet looked at before either. One thing found by the tests: I had added a guard for letters that change length when lower-cased (true in JavaScript, with the dotted capital I). It could never run: **in Dart no character changes length** (checked over every code point, and now a test), so the guard is gone.

**NOT checked.** **No phone, emulator or Mac**: how the mark looks on a real screen, in the light theme, and at large text sizes (the large-text scene passes with marks in it, but nothing was looked at). A **matched word hidden in a spoiler** finds the message but marks nothing (same as the web). **Not done:** matching without accents (`cafe` does not find `café`, as before), a person picker for `from:`, searching across channels.
