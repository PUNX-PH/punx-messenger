# iOS setup

Everything that can be done without a Mac is done and committed. **The iOS app has
never been compiled or run**; this page is the ordered list of what is left, and it
can only be done on a Mac. The bundle id is **`com.punx.plexus`**, matching Android.

## On the Mac, in order

You need: a Mac with current **Xcode**, **CocoaPods**, **Flutter** (`flutter doctor`
should be green for iOS), **Node 18+**, the **Firebase CLI**
(`npm i -g firebase-tools`), and an **Apple ID**. A free Apple ID is enough to run on
your own iPhone; TestFlight and the App Store need the paid Apple Developer Programme.

1. **Get the code.**
   ```bash
   git pull
   (cd android_app && flutter pub get)
   ```

2. **Firebase iOS app.** The app cannot launch without `GoogleService-Info.plist`,
   and there is no iOS app registered in the Firebase project that this repo knows
   about. First check, so it is not registered twice:
   ```bash
   firebase login --reauth
   firebase apps:list --project punx-msg
   ```
   If an iOS app (`com.punx.plexus`) is listed, use its App ID. If not, create one:
   ```bash
   firebase apps:create IOS "Punx Messenger iOS" --bundle-id com.punx.plexus --project punx-msg
   ```
   Then fetch the file (the console route, Project settings → Your apps → iOS, gives
   the same file). All of these run from the repo root:
   ```bash
   firebase apps:sdkconfig IOS <App ID> --project punx-msg --out android_app/ios/Runner/GoogleService-Info.plist
   ```
   Google sign-in must be enabled (Authentication → Sign-in method → Google). It
   already is, for the web app; the plist only contains `CLIENT_ID` and
   `REVERSED_CLIENT_ID` when it is.

3. **Wire it in, and check everything else.** From the repo root:
   ```bash
   node scripts/ios-setup.mjs --apply
   ```
   `--apply` makes exactly two edits, both idempotent: it registers Google's URL
   scheme in `Info.plist` (without it Google sign-in crashes instead of returning to
   the app) and adds `GoogleService-Info.plist` to the Runner target's resources
   in `project.pbxproj` (without that the file sits on disk but is **not in the app**,
   which launches and cannot find its Firebase configuration). Then it checks the
   rest. **A clean run ends with every line `ok` except one `warn` about the signing
   team**, which is yours to set in the next step. Any `FAIL` line says what is wrong
   and why it matters. Run it without `--apply` any time to just check.

   Then commit the result, so the next machine and CI do not repeat it:
   ```bash
   git add android_app/ios && git commit -m "Add the iOS Firebase config"
   ```
   The plist holds identifiers Firebase treats as public (an API key, a sender id,
   the client ids), like the Android `google-services.json` that is already
   committed; what actually protects the data is the Firestore rules. It is not a
   credential.

4. **Pods and signing.**
   ```bash
   cd android_app/ios && pod install && cd ..
   open ios/Runner.xcworkspace
   ```
   In Xcode: **Runner → Signing & Capabilities → Team**. If Xcode says the bundle id
   is not available, it has been claimed by a different Apple team; use the team that
   will publish the app. Do not change the bundle id: Firebase and Google sign-in are
   registered against `com.punx.plexus`.

5. **Compile it, then run it.**
   ```bash
   flutter build ios --release --no-codesign   # proves the project and every plugin build
   flutter devices
   flutter run --release -d <your iPhone>
   ```
   The first command is the real unknown: `flutter_webrtc` is the likeliest source of
   trouble, and nothing here has ever been compiled for a device.

6. **Walk the device checklist below.** Order matters: sign-in comes first, because
   everything else needs it.

7. **Ship to testers** once it works: `flutter build ipa`, then upload with Xcode
   (Organizer) or Transporter; or run `.github/workflows/ios.yml` with `signed` on
   (it needs the signing secrets listed in that file). See "Before the App Store"
   below.

## Device checklist

Things that cannot be judged from a desk. Stop at the first failure; each line says
where to look.

| # | Do this | If it fails |
|---|---|---|
| 1 | App launches and shows the sign-in screen | Crashes straight away: the plist is missing, or not in the app (re-run step 3) |
| 2 | **Continue with Google** opens a sheet, you sign in, and it returns to the app | Hangs or crashes on return: the URL scheme (step 3). A sign-in error instead: the plist is for the wrong app or project |
| 3 | Profile sheet → **Notifications** prompts and then shows On | Stays "blocked" with no prompt: the Podfile flag (`PERMISSION_NOTIFICATIONS=1`) did not take; run `pod install` again |
| 4 | Send and receive a DM; attach a photo | A photo that will not attach: the usage strings in `Info.plist` |
| 5 | **Join a voice channel**: microphone prompt, you hear others, mute and deafen work | Crash on the permission prompt: the usage strings. No audio: the audio session; see `docs/VOICE.md` |
| 6 | In the channel, press the home button and wait a minute: audio continues | Drops immediately: `UIBackgroundModes` (`audio`) in `Info.plist` |
| 7 | Camera on in voice; watch someone's screen share | |
| 8 | 1:1 call between two phones | Incoming calls ring **only while the app is open**: there is no push (see below) |
| 9 | **Sounds**: have a DM arrive while you are on another screen | See "Sound effects on iOS" |

## Sound effects on iOS

The sound effects (calls, DMs, voice) were written for both platforms but have only
been tested for logic, never heard on an iPhone. Two iOS-specific decisions:

- **Audio category is `ambient`.** The audio package otherwise sets the app's
  category to `playback` at launch, which ignores the silent switch (a ping would
  sound on a phone set to silent) and can interrupt other apps' audio. `ambient`
  respects silent mode and mixes. As a consequence a ring will be silent with the
  switch on; a real ringtone needs CallKit, which this app does not use.
- **Sounds are held back while a call or voice channel has live audio.** The package
  also activates and **deactivates** the shared audio session as sounds start and
  stop, and during a voice call that session is WebRTC's too. Whether a ping ending
  can cut a call's audio cannot be settled from a desk, so the guard is on:
  `playSoundsDuringLiveAudioOnIOS = false` in `lib/services/sfx_service.dart`. To
  test: set it to `true`, join a voice channel on a real iPhone, have a DM arrive,
  and check the call audio does not drop or change route. If it survives, leave it
  `true` (and update its test, which asserts the shipped value). If not, leave it
  `false`; voice and call chimes simply do not play on iOS.

## Before the App Store

None of this blocks running on your own phone or in TestFlight.

- **Sign in with Apple.** Apple's review guideline 4.8 requires offering Sign in
  with Apple alongside other third-party sign-in services, with exemptions
  (broadly: apps that use only the company's own account system). This app signs in
  with Google only, restricted to company addresses, but guests can join with any
  Google account through an invite link, which may take it outside that exemption.
  I have not verified how Apple would read this: check the current wording of the
  guideline, and decide before submitting for review.
- **Privacy answers.** App Store Connect asks for the privacy "nutrition label", and
  an app whose own code uses certain system APIs needs a `PrivacyInfo.xcprivacy`.
  Flutter and the Firebase pods ship their own; none was added speculatively. The
  upload will say if one is needed.
- **Push notifications** do not exist on any platform (below).

## Push notifications — not set up, and the Mac is not the blocker

**This app has no push notifications on any platform today.** There is no
`firebase_messaging` dependency. What exists is `notification_listener_service`,
which holds Firestore `.snapshots()` listeners and raises **local** notifications
from inside the running app. Nothing is sent from a server, and nothing arrives when
the app is closed.

Real push needs, in this order:

1. **A paid Apple Developer account ($99/yr).** The Push Notifications capability
   and APNs keys do not exist on a free account.
2. **A server-side send path.** Nothing currently watches Firestore server-side.
   This needs a Cloud Function on a message-created trigger, or the Worker doing it.
   This is the actual work, and it is shared with Android: neither platform has it.
3. **An APNs auth key** from the Apple Developer portal, uploaded into Firebase
   Cloud Messaging.
4. **Xcode capabilities**: Push Notifications, and Background Modes → remote
   notifications.
5. `firebase_messaging` in `pubspec.yaml`, plus storing each device's FCM token on
   the user document.

**The push entitlement is deliberately NOT pre-added.** Putting `aps-environment` in
an entitlements file fails signing unless the App ID carries the Push capability and
the provisioning profile matches, so adding it early breaks the build rather than
saving a step. Add it in Xcode once the account exists, which creates the App ID
capability and the entitlement together.

## What is already done

| Thing | Where |
|---|---|
| iOS platform generated, bundle id `com.punx.plexus` in every configuration | `android_app/ios/` |
| Camera, microphone and photo-library usage strings | `ios/Runner/Info.plist` |
| Background audio mode | `ios/Runner/Info.plist` (`UIBackgroundModes: audio`) |
| App icons, all sizes | `ios/Runner/Assets.xcassets/AppIcon.appiconset` |
| Deployment target 13.0 | `ios/Podfile`, `project.pbxproj` |
| `permission_handler` notifications switched on | `ios/Podfile` (`PERMISSION_NOTIFICATIONS=1`) |
| Local-notification init, foreground notification delegate | `lib/services/notification_listener_service.dart`, `ios/Runner/AppDelegate.swift` |
| Readiness check and the two wiring edits | `scripts/ios-setup.mjs`, tested by `tests/ios-setup.test.mjs` |
| Sound effects tuned for iOS (see above) | `lib/services/sfx_service.dart` |
| macOS CI workflow, runs the readiness check | `.github/workflows/ios.yml` (manual only: GitHub bills macOS minutes at 10x) |

Two of those are floors, not preferences:

- **iOS 13.0** is required by `flutter_webrtc` and by `firebase_core` 3.x /
  `firebase_auth` 5.x. Lowering it fails in CocoaPods resolution with a version
  conflict that looks unrelated to the deployment target.
- **The camera/microphone usage strings are mandatory.** iOS *terminates* the app
  when WebRTC first requests permission if they are absent, so voice would crash on
  first use rather than degrade.

## What iOS already has, for free

`android_app/` is one Flutter codebase, so everything shipped for Android is in the
iOS build the moment someone compiles it. Nothing on this list needs iOS-specific
work:

- **TURN relay** for voice channels and calls (`lib/services/turn_service.dart`):
  reaches the same Worker with the same Firebase ID token, no extra config
- The **native abort on joining voice**: remote audio tracks are left alone on
  arrival, which was a libwebrtc SIGABRT, not an Android quirk
- Voice signalling fixes, self-repair of silent voice pairs, ICE-failure reporting
- The UI port: day dividers, the jump-to-latest pill, the invite links screen
- GIF rendering, message paging

One thing genuinely differs: `ensureAudioSession` has no Android implementation in
flutter_webrtc and logs "audio session unavailable" there. On iOS it should actually
run; watch for it the first time voice is exercised on a device.

See `docs/VOICE.md` for how voice works and how to diagnose it.

## What the readiness script checks

`node scripts/ios-setup.mjs` (read-only) or `--apply` (also makes the two edits).
Exit code 1 if anything blocks a build, so it can gate CI.

| Check | Why it matters |
|---|---|
| `GoogleService-Info.plist` present, for `com.punx.plexus` and project `punx-msg`, with a Google client | Without it Firebase throws at launch; a plist for another app or project fails or signs people into the wrong place |
| Google's `REVERSED_CLIENT_ID` registered as a URL scheme | Google sign-in cannot return to the app |
| The plist is in the Runner target's resources | On disk is not the same as in the app |
| Camera, microphone, photo-library strings; background audio | Crashes and rejections, above |
| Podfile: iOS 13.0+, `PERMISSION_NOTIFICATIONS=1` | CocoaPods conflict; notifications that can never be enabled |
| Every bundle id and deployment target in the Xcode project | A stray `com.example…` is a common leftover |
| A signing team is set | A **warning**, not a failure: only a person can set it |
| `project.pbxproj` is well-formed | A broken project does not open |

## Known gaps

- No `GoogleService-Info.plist` yet (step 2); the app cannot launch without it
- Never compiled for iOS; `flutter_webrtc` is the likeliest source of trouble
- No push notifications on any platform (above)
- Sign in with Apple has not been decided (above)
- The sound effects are untested on a device (above)
- **Android** release builds need `android/key.properties` and fail without it
  (see RELEASE.md). Unrelated to iOS, but it is the other half of "shippable".
