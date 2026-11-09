# iOS test fixtures

`Info.plist` and `project.pbxproj` here are the real iOS project's two files **as they
were before `scripts/ios-setup.mjs --apply` wired in the Firebase config** (the Google
sign-in URL scheme, and the plist in the Runner target's resources).

`tests/ios-setup.test.mjs` starts every scenario from these, so it can test the
script's checks and edits from the unwired state even though the committed project is
now wired.

They must not drift. A test checks that the real files equal these two plus exactly the
script's two edits. If you legitimately change the real `Info.plist` or `project.pbxproj`
(a new usage string, a new build setting), apply the same change to the matching file
here and the guard passes again.
