// The iOS readiness checks, and the two edits `--apply` makes, run against a COPY
// of the real iOS project so the real one is never touched.
//
//   node --test tests/ios-setup.test.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLE_ID, PLIST_NAME, applyFixes, bundleIds, checkAll, hasUrlScheme, isBalanced,
  plistIsInResources, plistString, withPlistInResources, withUrlScheme,
} from '../scripts/ios-setup.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const realIos = join(root, 'android_app', 'ios')

const REVERSED = 'com.googleusercontent.apps.1234567890-abcdefghij'
const plistFile = ({ bundle = BUNDLE_ID, project = 'punx-msg', google = true } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	${google ? `<key>CLIENT_ID</key>
	<string>1234567890-abcdefghij.apps.googleusercontent.com</string>
	<key>REVERSED_CLIENT_ID</key>
	<string>${REVERSED}</string>` : ''}
	<key>API_KEY</key>
	<string>AIzaFakeKeyForTests</string>
	<key>GCM_SENDER_ID</key>
	<string>1234567890</string>
	<key>BUNDLE_ID</key>
	<string>${bundle}</string>
	<key>PROJECT_ID</key>
	<string>${project}</string>
	<key>GOOGLE_APP_ID</key>
	<string>1:1234567890:ios:abcdef</string>
</dict>
</plist>
`

let ios
beforeEach(() => {
  ios = mkdtempSync(join(tmpdir(), 'ios-copy-'))
  cpSync(realIos, ios, { recursive: true, filter: (src) => !/[\\/](Pods|\.symlinks|ephemeral)([\\/]|$)/.test(src) })
})
const put = (rel, text) => writeFileSync(join(ios, rel), text)
const get = (rel) => readFileSync(join(ios, rel), 'utf8')
const status = (results, id) => results.find(r => r.id === id)?.status
const withPlist = (opts) => put(`Runner/${PLIST_NAME}`, plistFile(opts))

// ── the project as committed ──
test('the committed project passes everything that does not need the Firebase file', () => {
  const r = checkAll({ iosDir: realIos })
  const failing = r.filter(x => x.status === 'fail').map(x => x.id)
  assert.deepEqual(failing, ['plist.present'], 'the plist is the one thing still missing')
  assert.equal(status(r, 'info.urlscheme'), 'blocked')
  assert.equal(status(r, 'xcode.plistref'), 'blocked')
  assert.equal(status(r, 'xcode.team'), 'warn', 'signing is for a person on the Mac')
})

test('the missing-plist message says how to get one', () => {
  const r = checkAll({ iosDir: realIos }).find(x => x.id === 'plist.present')
  assert.match(r.fix, /apps:create IOS/)
  assert.match(r.fix, /apps:sdkconfig IOS/)
  assert.match(r.fix, new RegExp(BUNDLE_ID))
})

// ── reading the plist ──
test('plistString reads values and returns null for a missing key', () => {
  const t = plistFile()
  assert.equal(plistString(t, 'BUNDLE_ID'), BUNDLE_ID)
  assert.equal(plistString(t, 'REVERSED_CLIENT_ID'), REVERSED)
  assert.equal(plistString(t, 'NOPE'), null)
})

// ── what a wrong plist looks like ──
test('a plist for another bundle id is refused', () => {
  withPlist({ bundle: 'com.someone.else' })
  const r = checkAll({ iosDir: ios })
  assert.equal(status(r, 'plist.bundle'), 'fail')
  assert.match(r.find(x => x.id === 'plist.bundle').detail, /com\.someone\.else/)
})

test('a plist for another Firebase project is refused', () => {
  withPlist({ project: 'some-other-project' })
  assert.equal(status(checkAll({ iosDir: ios }), 'plist.project'), 'fail')
})

test('a plist without the Google client says to enable the Google provider', () => {
  withPlist({ google: false })
  const r = checkAll({ iosDir: ios })
  assert.equal(status(r, 'plist.google'), 'fail')
  assert.match(r.find(x => x.id === 'plist.google').detail, /Google provider/)
  assert.equal(status(r, 'info.urlscheme'), 'blocked', 'no scheme can be derived without it')
})

// ── --apply ──
test('with a good plist, exactly the two fixable things fail', () => {
  withPlist()
  const failing = checkAll({ iosDir: ios }).filter(x => x.status === 'fail').map(x => x.id).sort()
  assert.deepEqual(failing, ['info.urlscheme', 'xcode.plistref'])
})

test('--apply fixes both, and then everything passes', () => {
  withPlist()
  const changed = applyFixes({ iosDir: ios })
  assert.equal(changed.length, 2)
  const r = checkAll({ iosDir: ios })
  assert.deepEqual(r.filter(x => x.status === 'fail'), [])
  assert.equal(status(r, 'info.urlscheme'), 'ok')
  assert.equal(status(r, 'xcode.plistref'), 'ok')
})

test('--apply is idempotent: the second run changes nothing', () => {
  withPlist()
  applyFixes({ iosDir: ios })
  const info = get('Runner/Info.plist'), pbx = get('Runner.xcodeproj/project.pbxproj')
  assert.deepEqual(applyFixes({ iosDir: ios }), [])
  assert.equal(get('Runner/Info.plist'), info)
  assert.equal(get('Runner.xcodeproj/project.pbxproj'), pbx)
})

test('--apply refuses to run without the plist, instead of half-working', () => {
  assert.throws(() => applyFixes({ iosDir: ios }), /not in ios\/Runner yet/)
})

// ── the Xcode project edit, in detail ──
test('the plist goes in the RUNNER target\'s resources, not the test target\'s', () => {
  const after = withPlistInResources(get('Runner.xcodeproj/project.pbxproj'))
  const phases = [...after.matchAll(/(\w{24}) \/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;([\s\S]*?)\n\t\t\};/g)]
  assert.equal(phases.length, 2, 'the project has a Runner phase and a RunnerTests phase')
  const holding = phases.filter(p => p[2].includes(`${PLIST_NAME} in Resources`))
  assert.equal(holding.length, 1)
  assert.ok(holding[0][2].includes('LaunchScreen.storyboard in Resources'), 'the one with the launch screen is the Runner target')
})

test('all four entries are written, and refer to each other', () => {
  const after = withPlistInResources(get('Runner.xcodeproj/project.pbxproj'))
  const build = /(\w{24}) \/\* GoogleService-Info\.plist in Resources \*\/ = \{isa = PBXBuildFile; fileRef = (\w{24})/.exec(after)
  const ref = /(\w{24}) \/\* GoogleService-Info\.plist \*\/ = \{isa = PBXFileReference;/.exec(after)
  assert.ok(build && ref, 'build file and file reference exist')
  assert.equal(build[2], ref[1], 'the build file points at the file reference')
  const group = /\/\* Runner \*\/ = \{\s*isa = PBXGroup;\s*children = \(([\s\S]*?)\);/.exec(after)
  assert.ok(group[1].includes(ref[1]), 'it is listed in the Runner group')
  assert.ok(after.includes(`${build[1]} /* ${PLIST_NAME} in Resources */,`), 'and in the resources phase')
})

test('the edit leaves the project well-formed and changes nothing else', () => {
  const before = get('Runner.xcodeproj/project.pbxproj')
  const after = withPlistInResources(before)
  assert.ok(isBalanced(after))
  const added = after.split(/\r?\n/).filter(l => !before.split(/\r?\n/).includes(l))
  assert.equal(added.length, 4, 'exactly four new lines')
  assert.ok(added.every(l => l.includes(PLIST_NAME)))
  assert.equal(after.split(/\r?\n/).length, before.split(/\r?\n/).length + 4)
})

test('the ids are the same every time, so the diff is reviewable', () => {
  const pbx = get('Runner.xcodeproj/project.pbxproj')
  assert.equal(withPlistInResources(pbx), withPlistInResources(pbx))
})

test('line endings are kept', () => {
  const crlf = get('Runner.xcodeproj/project.pbxproj').replace(/\r?\n/g, '\r\n')
  const after = withPlistInResources(crlf)
  assert.equal(after.replace(/\r\n/g, ''), after.replace(/\r/g, '').replace(/\n/g, ''), 'no lone newlines were introduced')
  assert.ok(!/[^\r]\n/.test(after))
})

test('a project that is not the shape we expect is refused, not mangled', () => {
  assert.throws(() => withPlistInResources('// not a project\n{ }'), /expected section/)
})

test('plistIsInResources recognises it', () => {
  const pbx = get('Runner.xcodeproj/project.pbxproj')
  assert.equal(plistIsInResources(pbx), false)
  assert.equal(plistIsInResources(withPlistInResources(pbx)), true)
})

// ── Info.plist URL scheme ──
test('the URL scheme is added where there was none', () => {
  const info = withUrlScheme(get('Runner/Info.plist'), REVERSED)
  assert.ok(hasUrlScheme(info, REVERSED))
  assert.ok(info.includes('<key>CFBundleURLTypes</key>'))
  assert.ok(info.trimEnd().endsWith('</plist>'))
})

test('it is added to an existing list of URL types, not a second list', () => {
  // (Normalised to \n first: the checkout may have converted the file to CRLF.)
  const existing = get('Runner/Info.plist').replace(/\r\n/g, '\n').replace('</dict>\n</plist>', `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>fb1234</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>`).replace('</dict>\r\n</plist>', '</dict>\r\n</plist>')
  assert.ok(existing.includes('fb1234'))
  const info = withUrlScheme(existing, REVERSED)
  assert.ok(hasUrlScheme(info, REVERSED))
  assert.ok(info.includes('fb1234'), 'the other SDK\'s scheme survives')
  assert.equal(info.split('<key>CFBundleURLTypes</key>').length, 2, 'still exactly one URL types list')
})

test('adding the scheme twice changes nothing', () => {
  const once = withUrlScheme(get('Runner/Info.plist'), REVERSED)
  assert.equal(withUrlScheme(once, REVERSED), once)
})

// ── the other checks catch real mistakes ──
test('a lowered Podfile platform is caught', () => {
  put('Podfile', get('Podfile').replace("platform :ios, '13.0'", "platform :ios, '12.0'"))
  assert.equal(status(checkAll({ iosDir: ios }), 'podfile.platform'), 'fail')
})

test('a Podfile without the notifications flag is caught', () => {
  put('Podfile', get('Podfile').replaceAll('PERMISSION_NOTIFICATIONS=1', 'PERMISSION_SOMETHING_ELSE=1'))
  assert.equal(status(checkAll({ iosDir: ios }), 'podfile.notifications'), 'fail')
})

test('a flag that is only mentioned in a comment does not count', () => {
  const code = get('Podfile').replaceAll('PERMISSION_NOTIFICATIONS=1', 'PERMISSION_SOMETHING_ELSE=1')
  put('Podfile', `# PERMISSION_NOTIFICATIONS=1 (someone commented it out)\n${code}`)
  assert.equal(status(checkAll({ iosDir: ios }), 'podfile.notifications'), 'fail')
})

test('the committed Podfile sets the flag in code, not just in a comment', () => {
  assert.equal(status(checkAll({ iosDir: realIos }), 'podfile.notifications'), 'ok')
})

test('a stray bundle id in the project is caught', () => {
  const pbx = get('Runner.xcodeproj/project.pbxproj')
  put('Runner.xcodeproj/project.pbxproj', pbx.replace('PRODUCT_BUNDLE_IDENTIFIER = com.punx.plexus;', 'PRODUCT_BUNDLE_IDENTIFIER = com.example.punxMessenger;'))
  const r = checkAll({ iosDir: ios }).find(x => x.id === 'xcode.bundleid')
  assert.equal(r.status, 'fail')
  assert.match(r.detail, /com\.example\.punxMessenger/)
})

test('a missing usage string is caught', () => {
  for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    put('Runner/Info.plist', get('Runner/Info.plist').replace(`<key>${key}</key>`, '<key>NSSomethingElse</key>'))
    assert.equal(status(checkAll({ iosDir: ios }), `info.${key}`), 'fail', key)
    put('Runner/Info.plist', readFileSync(join(realIos, 'Runner', 'Info.plist'), 'utf8')) // restore for the next key
  }
})

test('losing the background audio mode is caught', () => {
  put('Runner/Info.plist', get('Runner/Info.plist').replace('<string>audio</string>', '<string>fetch</string>'))
  assert.equal(status(checkAll({ iosDir: ios }), 'info.audio'), 'fail')
})

test('a project whose braces do not balance is caught', () => {
  put('Runner.xcodeproj/project.pbxproj', get('Runner.xcodeproj/project.pbxproj') + '\n}')
  assert.equal(status(checkAll({ iosDir: ios }), 'xcode.wellformed'), 'fail')
})

test('bundleIds lists every configuration', () => {
  assert.ok(bundleIds(get('Runner.xcodeproj/project.pbxproj')).length >= 6)
})

test('the real project was never modified by these tests', () => {
  assert.equal(existsSync(join(realIos, 'Runner', PLIST_NAME)), false)
  assert.equal(plistIsInResources(readFileSync(join(realIos, 'Runner.xcodeproj', 'project.pbxproj'), 'utf8')), false)
})

test.after(() => { try { rmSync(ios, { recursive: true, force: true }) } catch {} })
