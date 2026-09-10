# iOS setup

Everything that can be done from Windows is committed. This is the list of what
can only be done on a Mac, in the order that unblocks things.

The iOS platform did not exist before 2026-09-10; it was generated and
configured then. Bundle id is **`com.punx.plexus`**, matching Android.

## Already done — do not redo

| Thing | Where |
|---|---|
| iOS platform generated | `android_app/ios/` |
| Bundle id aligned to `com.punx.plexus` | `ios/Runner.xcodeproj/project.pbxproj` (6 places, incl. RunnerTests) |
| Camera + microphone usage strings | `ios/Runner/Info.plist` |
| Background audio mode | `ios/Runner/Info.plist` (`UIBackgroundModes: audio`) |
| App icons, all 22 sizes | `ios/Runner/Assets.xcassets/AppIcon.appiconset` |
| Podfile, deployment target pinned to 13.0 | `ios/Podfile` |
| Local-notification init for iOS | `lib/services/notification_listener_service.dart` |
| Foreground notification delegate | `ios/Runner/AppDelegate.swift` |
| macOS CI workflow | `.github/workflows/ios.yml` |

Two of those are floors, not preferences:

- **iOS 13.0** is required by `flutter_webrtc` and by `firebase_core` 3.x /
  `firebase_auth` 5.x. Lowering it fails in CocoaPods resolution with a version
  conflict that looks unrelated to the deployment target.
- **The camera/microphone usage strings are mandatory.** iOS *terminates* the
  app when WebRTC first requests permission if they are absent, so voice would
  crash on first use rather than degrade.

## 1. Firebase iOS app — required before the app will run at all

`DefaultFirebaseOptions.currentPlatform` returns `null` off web (see
`lib/firebase_options.dart`), so native platforms read their own config file.
Android reads `google-services.json`; iOS reads `GoogleService-Info.plist`,
which does not exist yet.

1. Firebase console → project **`punx-msg`** → add an **iOS** app
2. Bundle id: **`com.punx.plexus`**
3. Download `GoogleService-Info.plist` → put it in `android_app/ios/Runner/`
4. Add it to the Xcode project (drag into `Runner` in Xcode, or it will not be
   copied into the bundle even though the file is on disk)

Without it, `Firebase.initializeApp()` throws on launch.

The `google-services.json` in the repo is Android-only — both of its clients
are `android_client_info`. It is not a substitute.

## 2. Build

```bash
cd android_app
flutter pub get
cd ios && pod install && cd ..
open ios/Runner.xcworkspace     # set a signing team under Signing & Capabilities
flutter build ipa
```

`flutter build ios --release --no-codesign` compiles without any Apple account
and is worth running first — it proves the project, the Podfile and every
plugin (`flutter_webrtc` above all) build for an arm64 device. That is the
genuine unknown; nothing here has ever been compiled for iOS.

`.github/workflows/ios.yml` does all of the above on a GitHub macOS runner if
you would rather not build locally. It is `workflow_dispatch` only, because
GitHub bills macOS minutes at 10x the Linux rate.

## 3. Push notifications — not set up, and the Mac is not the blocker

**This app has no push notifications on any platform today.** There is no
`firebase_messaging` dependency. What exists is `notification_listener_service`,
which holds Firestore `.snapshots()` listeners and raises **local**
notifications from inside the running app. Nothing is sent from a server, and
nothing arrives when the app is closed.

Real push needs, in this order:

1. **A paid Apple Developer account ($99/yr).** The Push Notifications
   capability and APNs keys do not exist on a free account.
2. **A server-side send path.** Nothing currently watches Firestore
   server-side. This needs a Cloud Function on a message-created trigger, or
   the Worker doing it. This is the actual work, and it is shared with Android
   — neither platform has it.
3. **An APNs auth key** from the Apple Developer portal, uploaded into Firebase
   Cloud Messaging.
4. **Xcode capabilities**: Push Notifications, and Background Modes → remote
   notifications.
5. `firebase_messaging` in `pubspec.yaml`, plus storing each device's FCM token
   on the user document.

**The push entitlement is deliberately NOT pre-added.** Putting
`aps-environment` in an entitlements file fails signing unless the App ID
carries the Push capability and the provisioning profile matches — so adding it
early breaks the build rather than saving a step. Add it in Xcode once the
account exists, which creates the App ID capability and the entitlement
together.

## Known gaps

- No `GoogleService-Info.plist` (step 1) — the app cannot launch without it
- Never compiled for iOS; `flutter_webrtc` is the likeliest source of trouble
- No push notifications on any platform (see above)
- Release signing on **Android** is still the scaffold default (debug keys), so
  Android APKs are sideload-only and not Play-eligible. Unrelated to iOS, but
  it is the other half of "shippable".
