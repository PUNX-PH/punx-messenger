#!/usr/bin/env bash
# The first iOS build, on a Mac, in one command:
#
#   bash scripts/ios-first-build.sh
#
# It checks the machine has what iOS needs, checks the project (the same check as
# `node scripts/ios-setup.mjs`), installs Flutter packages and CocoaPods, and compiles
# the app without signing. It stops at the first thing that is wrong and says what.
# What it cannot do is choose your signing team: that is one click in Xcode, and the
# last thing it prints.
#
# See docs/IOS.md for what each step is for and the checklist to run on the phone.
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this from inside the punx-messenger repository."

[ "$(uname)" = "Darwin" ] || fail "iOS apps can only be built on a Mac (this is $(uname)). Without one, run the 'Build iOS (macOS runner)' workflow in GitHub Actions instead; docs/IOS.md explains."

say "1/5  What this Mac has"
missing=0
for tool in git node flutter pod xcodebuild; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '  ok    %s\n' "$tool"
  else
    printf '  MISSING  %s\n' "$tool"; missing=1
  fi
done
[ "$missing" -eq 0 ] || fail "Install what is missing: Xcode from the App Store, then 'sudo gem install cocoapods' (or 'brew install cocoapods'), Flutter from flutter.dev, Node from nodejs.org. Then run this again."
xcode-select -p >/dev/null 2>&1 || fail "Xcode's command line tools are not selected. Run: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
xcodebuild -version | head -1 | sed 's/^/  /'

say "2/5  Is the project ready? (node scripts/ios-setup.mjs)"
# Exit code 1 only for a blocking problem; a missing signing team is a warning.
node scripts/ios-setup.mjs || fail "The project check found a blocking problem (above). It says what is wrong and how to fix it. Fix that and run this again."

say "3/5  Flutter packages"
( cd android_app && flutter pub get )

say "4/5  CocoaPods (the native half of every plugin; the first run downloads a lot)"
( cd android_app/ios && pod install )

say "5/5  Compile for a device, unsigned (proves the project and every plugin build)"
( cd android_app && flutter build ios --release --no-codesign )

cat <<'EOF'

It compiles.

Last steps, which need you:
  1. open android_app/ios/Runner.xcworkspace
  2. In Xcode: Runner -> Signing & Capabilities -> Team (a free Apple ID builds to your own phone)
  3. Plug in an iPhone, then: cd android_app && flutter run --release -d <your iPhone>
  4. Walk the device checklist in docs/IOS.md, starting with sign-in.
EOF
