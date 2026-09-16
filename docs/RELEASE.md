# Releasing the Android app

## Signing

Release builds are signed from `android_app/android/key.properties`, which is
**gitignored** — it holds passwords and the path to a keystore that lives
outside this repo. Copy `key.properties.example` and fill it in.

```properties
storeFile=D:/WebProjects/Keys/punx-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

**Without that file the release build falls back to the debug key.** That is
deliberate: a fresh clone, CI, or another machine can still produce a working
sideloadable APK instead of failing the build. But Play rejects a debug-signed
upload outright, so a real release needs the file present.

Check which key an artefact actually carries rather than assuming:

```bash
unzip -l app-release.aab | grep META-INF
```

`ANDROIDD.RSA` is the debug key. Your own alias means it is signed for release.

### The keystore has no recovery path

Lose it and you can never update the app on Play again — a new key means a new
listing. It is not in this repo and must not be. Back it up somewhere durable,
with its password stored separately.

## Building

```bash
cd android_app
flutter build appbundle --release      # AAB, for Play
flutter build apk --release --split-per-abi   # APKs, for sideloading
```

The AAB bundles every ABI and Play serves each device the slice it needs. The
split APKs exist for handing someone a file directly:

| File | For |
|---|---|
| `app-arm64-v8a-release.apk` | any modern phone |
| `app-armeabi-v7a-release.apk` | older 32-bit devices |
| `app-x86_64-release.apk` | emulators (MuMu, Android Studio) |

Verify identity from the artefact, never from the config:

```bash
aapt dump badging app-arm64-v8a-release.apk | head -1
```

## ⚠️ Google Sign-In breaks on Play unless you add the SHA-1

This one is invisible until real users hit it: the build works, sideloading
works, and sign-in fails **only** for people who installed from Play.

Google Sign-In authorises against **package name + signing certificate**. With
Play App Signing, Google re-signs your upload with *their* key, so the
certificate users actually run is not the one you signed with.

After the first upload:

1. Play Console → your app → **Release → Setup → App integrity → App signing**
2. Copy the **SHA-1** under "App signing key certificate"
3. Firebase console → project `punx-msg` → the `com.punx.plexus` Android app →
   **Add fingerprint**

Add the **upload** key's SHA-1 there too, so locally-signed builds keep working.

`google-services.json` currently carries SHA-1
`12bf9945d20a10ead70ed2171954de3f38855eaf` — the **debug** key, which is why
sideloaded builds sign in today. Adding fingerprints in the console means
re-downloading `google-services.json` into `android_app/android/app/`.

## Versioning

`pubspec.yaml`'s `version: 1.0.0+1` drives both — `1.0.0` is `versionName`, `1`
is `versionCode`.

**Play requires a higher `versionCode` for every upload**, and it can never go
down. The name can stay the same across builds; the number cannot repeat.

Note that `--split-per-abi` offsets the code per ABI (arm64 becomes `2001`,
x86_64 `4001`), so a split APK will refuse to install over a universal one with
a lower number. That only affects sideloading; the AAB is unaffected.

## Order of operations for a first release

1. Generate the upload keystore (`keytool -genkey ... -alias upload`), outside
   the repo
2. Fill in `key.properties`
3. `flutter build appbundle --release`, and confirm it is not debug-signed
4. Play Console → Create app → upload to **Internal testing** first
5. Take the app-signing SHA-1 into Firebase (above) before anyone tries to sign
   in from Play
