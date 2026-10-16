/**
 * Checks that the iOS project is ready to build, and fixes what can be fixed
 * without Xcode.
 *
 *   node scripts/ios-setup.mjs            # check only; exit 1 if anything blocks a build
 *   node scripts/ios-setup.mjs --apply    # also wire in GoogleService-Info.plist
 *
 * Why this exists. The iOS app has never been compiled, and most of what goes wrong
 * the first time is not code but configuration that fails late and obscurely:
 * Google sign-in crashing because a URL scheme is missing, notifications that can
 * never be switched on, a Firebase file that sits on disk but was never added to
 * the Xcode project and so is not in the app. This checks all of it in a second, on
 * any machine with Node, and tests/ios-setup.test.mjs keeps the checks honest.
 *
 * What it will not do: it cannot create the Firebase iOS app, sign the build, or
 * run Xcode. Those are steps for the Mac; docs/IOS.md lists them in order.
 *
 * `--apply` is limited to two edits, both mechanical and both idempotent: adding
 * the Google URL scheme to Info.plist, and adding GoogleService-Info.plist to the
 * Runner target's resources in project.pbxproj (the same four entries Xcode writes
 * when you drag a file in). Running it twice changes nothing the second time.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUNDLE_ID = 'com.punx.plexus'
export const FIREBASE_PROJECT = 'punx-msg'
export const PLIST_NAME = 'GoogleService-Info.plist'

const REQUIRED_PODFILE_PLATFORM = '13.0' // flutter_webrtc and firebase 3.x need it

// ───────────────────────── reading ─────────────────────────

const read = (p) => readFileSync(p, 'utf8')
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n')

/** The value of a top-level key in a GoogleService-Info.plist (strings only). */
export function plistString(text, key) {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text)
  return m ? m[1].trim() : null
}

/** Every `PRODUCT_BUNDLE_IDENTIFIER = x;` in a project file. */
export const bundleIds = (pbx) => [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(m => m[1].trim())

/** Every deployment target in a project file. */
export const deploymentTargets = (pbx) => [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map(m => m[1].trim())

/** Braces and parentheses balance — a cheap proof that an edit did not break the file. */
export function isBalanced(text) {
  let brace = 0, paren = 0
  for (const ch of text) {
    if (ch === '{') brace++
    else if (ch === '}') brace--
    else if (ch === '(') paren++
    else if (ch === ')') paren--
    if (brace < 0 || paren < 0) return false
  }
  return brace === 0 && paren === 0
}

// ───────────────────────── the checks ─────────────────────────

/**
 * @typedef {{ id: string, label: string, status: 'ok'|'fail'|'warn'|'blocked', detail?: string, fix?: string }} Result
 *   fail    blocks a build or crashes the app on first use
 *   warn    needs a person on the Mac (signing), not a code change
 *   blocked cannot be judged until an earlier step is done
 */

export function checkAll({ iosDir }) {
  /** @type {Result[]} */
  const out = []
  const add = (r) => out.push(r)

  const runner = join(iosDir, 'Runner')
  const plistPath = join(runner, PLIST_NAME)
  const infoPath = join(runner, 'Info.plist')
  const pbxPath = join(iosDir, 'Runner.xcodeproj', 'project.pbxproj')
  const podfilePath = join(iosDir, 'Podfile')

  const info = existsSync(infoPath) ? read(infoPath) : ''
  const pbx = existsSync(pbxPath) ? read(pbxPath) : ''
  const podfile = existsSync(podfilePath) ? read(podfilePath) : ''

  // ── Firebase ──
  const havePlist = existsSync(plistPath)
  let plist = ''
  if (!havePlist) {
    add({
      id: 'plist.present', status: 'fail',
      label: `${PLIST_NAME} is in ios/Runner`,
      detail: 'Not there. Without it Firebase.initializeApp() throws at launch and the app cannot start.',
      fix: `firebase apps:create IOS "Punx Messenger iOS" --bundle-id ${BUNDLE_ID} --project ${FIREBASE_PROJECT}\n` +
           `    firebase apps:sdkconfig IOS <the App ID it printed> --project ${FIREBASE_PROJECT} --out android_app/ios/Runner/${PLIST_NAME}\n` +
           '    (or download it from the Firebase console: Project settings, Your apps, iOS)',
    })
  } else {
    plist = read(plistPath)
    add({ id: 'plist.present', status: 'ok', label: `${PLIST_NAME} is in ios/Runner` })

    const bid = plistString(plist, 'BUNDLE_ID')
    add(bid === BUNDLE_ID
      ? { id: 'plist.bundle', status: 'ok', label: `plist is for ${BUNDLE_ID}` }
      : { id: 'plist.bundle', status: 'fail', label: `plist is for ${BUNDLE_ID}`,
          detail: `It says BUNDLE_ID = ${bid ?? '(missing)'}. Firebase rejects a build whose bundle id differs; register the iOS app with ${BUNDLE_ID} and download the plist again.` })

    const pid = plistString(plist, 'PROJECT_ID')
    add(pid === FIREBASE_PROJECT
      ? { id: 'plist.project', status: 'ok', label: `plist is for project ${FIREBASE_PROJECT}` }
      : { id: 'plist.project', status: 'fail', label: `plist is for project ${FIREBASE_PROJECT}`,
          detail: `It says PROJECT_ID = ${pid ?? '(missing)'}: this would sign people into a different Firebase project.` })

    const reversed = plistString(plist, 'REVERSED_CLIENT_ID')
    add(plistString(plist, 'CLIENT_ID') && reversed
      ? { id: 'plist.google', status: 'ok', label: 'plist carries the Google sign-in client' }
      : { id: 'plist.google', status: 'fail', label: 'plist carries the Google sign-in client',
          detail: 'No CLIENT_ID / REVERSED_CLIENT_ID, which Google sign-in needs. Turn on the Google provider under Authentication in the Firebase console, then download the plist again.' })
  }

  const reversed = havePlist ? plistString(plist, 'REVERSED_CLIENT_ID') : null

  // ── Google sign-in URL scheme ──
  if (!reversed) {
    add({ id: 'info.urlscheme', status: 'blocked', label: 'Info.plist has the Google sign-in URL scheme', detail: 'Needs the plist first.' })
  } else if (hasUrlScheme(info, reversed)) {
    add({ id: 'info.urlscheme', status: 'ok', label: 'Info.plist has the Google sign-in URL scheme' })
  } else {
    add({ id: 'info.urlscheme', status: 'fail', label: 'Info.plist has the Google sign-in URL scheme',
      detail: `${reversed} is not registered as a URL scheme. Google sign-in cannot return to the app and crashes instead.`,
      fix: 'node scripts/ios-setup.mjs --apply' })
  }

  // ── The plist is actually in the app ──
  if (!havePlist) {
    add({ id: 'xcode.plistref', status: 'blocked', label: `${PLIST_NAME} is in the Runner target's resources`, detail: 'Needs the plist first.' })
  } else if (plistIsInResources(pbx)) {
    add({ id: 'xcode.plistref', status: 'ok', label: `${PLIST_NAME} is in the Runner target's resources` })
  } else {
    add({ id: 'xcode.plistref', status: 'fail', label: `${PLIST_NAME} is in the Runner target's resources`,
      detail: 'The file is on disk but the Xcode project does not copy it into the app, so the app launches and cannot find its Firebase configuration.',
      fix: 'node scripts/ios-setup.mjs --apply' })
  }

  // ── Info.plist strings and modes ──
  for (const [key, why] of [
    ['NSCameraUsageDescription', 'iOS terminates the app the first time WebRTC asks for the camera without it'],
    ['NSMicrophoneUsageDescription', 'iOS terminates the app the first time WebRTC asks for the microphone without it'],
    ['NSPhotoLibraryUsageDescription', 'attaching a photo can be refused without it, and App Review looks for it'],
  ]) {
    add(info.includes(`<key>${key}</key>`)
      ? { id: `info.${key}`, status: 'ok', label: `Info.plist has ${key}` }
      : { id: `info.${key}`, status: 'fail', label: `Info.plist has ${key}`, detail: why })
  }
  add(/<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*?<string>audio<\/string>/.test(info)
    ? { id: 'info.audio', status: 'ok', label: 'Info.plist allows background audio (voice keeps going when you leave the app)' }
    : { id: 'info.audio', status: 'fail', label: 'Info.plist allows background audio', detail: 'Voice would drop the moment the app goes to the background.' })

  // ── Podfile ──
  const platform = /platform :ios, '([\d.]+)'/.exec(podfile)?.[1]
  add(platform && Number(platform) >= Number(REQUIRED_PODFILE_PLATFORM)
    ? { id: 'podfile.platform', status: 'ok', label: `Podfile targets iOS ${platform} (needs ${REQUIRED_PODFILE_PLATFORM}+)` }
    : { id: 'podfile.platform', status: 'fail', label: `Podfile targets iOS ${REQUIRED_PODFILE_PLATFORM}+`, detail: `Found ${platform ?? 'nothing'}. flutter_webrtc and firebase 3.x need ${REQUIRED_PODFILE_PLATFORM}; lowering it fails in CocoaPods with a confusing version conflict.` })
  // Comment lines are ignored: a flag that is only MENTIONED in a comment is not set.
  const podfileCode = podfile.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n')
  add(podfileCode.includes('PERMISSION_NOTIFICATIONS=1')
    ? { id: 'podfile.notifications', status: 'ok', label: 'Podfile switches on permission_handler notifications' }
    : { id: 'podfile.notifications', status: 'fail', label: 'Podfile switches on permission_handler notifications',
        detail: 'Without PERMISSION_NOTIFICATIONS=1 the plugin compiles that permission out: notifications can never be enabled on iOS, and it reports "denied" with no explanation.' })

  // ── Xcode project ──
  const ids = bundleIds(pbx)
  const badIds = ids.filter(i => i !== BUNDLE_ID && i !== `${BUNDLE_ID}.RunnerTests`)
  add(ids.length && !badIds.length
    ? { id: 'xcode.bundleid', status: 'ok', label: `every build configuration uses ${BUNDLE_ID}` }
    : { id: 'xcode.bundleid', status: 'fail', label: `every build configuration uses ${BUNDLE_ID}`, detail: ids.length ? `Found ${[...new Set(badIds)].join(', ')}.` : 'No bundle identifiers found in project.pbxproj.' })

  const targets = deploymentTargets(pbx)
  add(targets.length && targets.every(t => Number(t) >= Number(REQUIRED_PODFILE_PLATFORM))
    ? { id: 'xcode.target', status: 'ok', label: `Xcode deployment target is ${[...new Set(targets)].join(', ')}` }
    : { id: 'xcode.target', status: 'fail', label: `Xcode deployment target is ${REQUIRED_PODFILE_PLATFORM}+`, detail: `Found ${[...new Set(targets)].join(', ') || 'none'}.` })

  add(/DEVELOPMENT_TEAM = [A-Z0-9]{10};/.test(pbx)
    ? { id: 'xcode.team', status: 'ok', label: 'a signing team is set' }
    : { id: 'xcode.team', status: 'warn', label: 'a signing team is set',
        detail: 'None yet, and it cannot be set from here. In Xcode: Runner, Signing & Capabilities, choose a Team (a free Apple ID builds to your own phone; TestFlight needs the paid programme).' })

  add(isBalanced(pbx) && pbx.length
    ? { id: 'xcode.wellformed', status: 'ok', label: 'project.pbxproj is well-formed (braces balance)' }
    : { id: 'xcode.wellformed', status: 'fail', label: 'project.pbxproj is well-formed', detail: 'Braces or parentheses do not balance; the project will not open.' })

  return out
}

// ───────────────────────── the two fixes ─────────────────────────

/** Is `scheme` registered under CFBundleURLTypes? */
export function hasUrlScheme(info, scheme) {
  const types = /<key>CFBundleURLTypes<\/key>\s*<array>([\s\S]*?)<\/array>\s*(?=<key>|<\/dict>)/.exec(info)
  return !!types && types[1].includes(`<string>${scheme}</string>`)
}

/** Returns Info.plist text with `scheme` registered, or the same text if it already is. */
export function withUrlScheme(info, scheme) {
  if (hasUrlScheme(info, scheme)) return info
  const eol = eolOf(info)
  const t = '\t'
  if (!info.includes('<key>CFBundleURLTypes</key>')) {
    const block = [
      `${t}<key>CFBundleURLTypes</key>`,
      `${t}<array>`,
      `${t}${t}<dict>`,
      `${t}${t}${t}<key>CFBundleTypeRole</key>`,
      `${t}${t}${t}<string>Editor</string>`,
      `${t}${t}${t}<key>CFBundleURLSchemes</key>`,
      `${t}${t}${t}<array>`,
      `${t}${t}${t}${t}<string>${scheme}</string>`,
      `${t}${t}${t}</array>`,
      `${t}${t}</dict>`,
      `${t}</array>`,
    ].join(eol) + eol
    const at = info.lastIndexOf('</dict>')
    if (at < 0) throw new Error('Info.plist has no closing </dict>; edit it by hand')
    return info.slice(0, at) + block + info.slice(at)
  }
  // URL types already exist (another SDK added one): add our scheme to the first
  // CFBundleURLSchemes array rather than guess at the rest of the structure.
  const arr = /(<key>CFBundleURLSchemes<\/key>\s*<array>)/.exec(info)
  if (!arr) throw new Error('Info.plist has CFBundleURLTypes but no CFBundleURLSchemes; edit it by hand')
  const at = arr.index + arr[0].length
  return info.slice(0, at) + `${eol}${t}${t}${t}${t}<string>${scheme}</string>` + info.slice(at)
}

/** Is GoogleService-Info.plist in some PBXResourcesBuildPhase? */
export function plistIsInResources(pbx) {
  const phase = /\/\* Begin PBXResourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXResourcesBuildPhase section \*\//.exec(pbx)
  return !!phase && phase[1].includes(`${PLIST_NAME} in Resources`)
}

// Xcode ids are 24 hex characters. Derived from the name rather than random, so
// two runs (or two machines) write the SAME ids and the diff stays reviewable.
const idFor = (what) => createHash('sha1').update(`punx-ios-setup:${PLIST_NAME}:${what}`).digest('hex').slice(0, 24).toUpperCase()

/**
 * Returns project.pbxproj text with GoogleService-Info.plist added to the Runner
 * target's resources — the four entries Xcode writes when a file is dragged in.
 * The same text back if it is already there.
 */
export function withPlistInResources(pbx) {
  if (plistIsInResources(pbx)) return pbx
  const eol = eolOf(pbx)
  const fileRef = idFor('fileRef')
  const buildFile = idFor('buildFile')
  if (pbx.includes(fileRef) || pbx.includes(buildFile)) throw new Error('project.pbxproj already uses the ids this edit would add')

  const edit = (text, marker, insert, where) => {
    const at = text.indexOf(marker)
    if (at < 0) throw new Error(`project.pbxproj does not have the expected section: ${marker.trim()}`)
    const end = at + marker.length
    return where === 'after' ? text.slice(0, end) + insert + text.slice(end) : text.slice(0, at) + insert + text.slice(at)
  }

  // 1. PBXBuildFile
  let out = edit(pbx, '/* Begin PBXBuildFile section */' + eol,
    `\t\t${buildFile} /* ${PLIST_NAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRef} /* ${PLIST_NAME} */; };${eol}`, 'after')

  // 2. PBXFileReference
  out = edit(out, '/* Begin PBXFileReference section */' + eol,
    `\t\t${fileRef} /* ${PLIST_NAME} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "${PLIST_NAME}"; sourceTree = "<group>"; };${eol}`, 'after')

  // 3. The Runner group, so it shows in the navigator (and is found where it sits on disk)
  const group = /(\/\* Runner \*\/ = \{\s*isa = PBXGroup;\s*children = \(\s*)/.exec(out)
  if (!group) throw new Error('project.pbxproj has no "Runner" group to add the file to')
  out = out.slice(0, group.index + group[0].length) + `${fileRef} /* ${PLIST_NAME} */,${eol}\t\t\t\t` + out.slice(group.index + group[0].length)

  // 4. The Resources phase of the Runner TARGET, which is the one holding the launch
  //    screen. The project has two such phases (the app's, and RunnerTests', which is
  //    empty) and the file belongs in the first, so each phase is matched on its own:
  //    \`[^)]*\` stops at that phase's closing parenthesis, so the pattern can never run
  //    on into the next phase and pick the wrong list. (An earlier version did exactly
  //    that and wrote the plist into the test target, where it would never reach the app.)
  const phaseRe = /\/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;\s*buildActionMask = \d+;\s*files = \(([^)]*)\);/g
  let runnerPhase = null
  for (const m of out.matchAll(phaseRe)) {
    if (m[1].includes('LaunchScreen.storyboard in Resources')) runnerPhase = m
  }
  if (!runnerPhase) throw new Error('project.pbxproj has no Runner resources phase (one containing LaunchScreen.storyboard)')
  const filesOpen = runnerPhase.index + runnerPhase[0].indexOf('files = (') + 'files = ('.length
  out = out.slice(0, filesOpen) + `${eol}\t\t\t\t${buildFile} /* ${PLIST_NAME} in Resources */,` + out.slice(filesOpen)

  if (!isBalanced(out)) throw new Error('the edit left project.pbxproj unbalanced; refusing to write it')
  return out
}

/** Applies the two fixes in `iosDir`. Returns what changed. */
export function applyFixes({ iosDir }) {
  const changed = []
  const plistPath = join(iosDir, 'Runner', PLIST_NAME)
  if (!existsSync(plistPath)) throw new Error(`${PLIST_NAME} is not in ios/Runner yet; nothing to wire in`)
  const reversed = plistString(read(plistPath), 'REVERSED_CLIENT_ID')

  const infoPath = join(iosDir, 'Runner', 'Info.plist')
  if (reversed) {
    const before = read(infoPath)
    const after = withUrlScheme(before, reversed)
    if (after !== before) { writeFileSync(infoPath, after); changed.push('Info.plist: added the Google sign-in URL scheme') }
  }

  const pbxPath = join(iosDir, 'Runner.xcodeproj', 'project.pbxproj')
  const beforePbx = read(pbxPath)
  const afterPbx = withPlistInResources(beforePbx)
  if (afterPbx !== beforePbx) { writeFileSync(pbxPath, afterPbx); changed.push(`project.pbxproj: added ${PLIST_NAME} to the Runner target's resources`) }
  return changed
}

// ───────────────────────── command line ─────────────────────────

export function render(results) {
  const mark = { ok: 'ok  ', fail: 'FAIL', warn: 'warn', blocked: '....' }
  const lines = []
  for (const r of results) {
    lines.push(`  [${mark[r.status]}] ${r.label}`)
    if (r.status !== 'ok' && r.detail) lines.push(`         ${r.detail}`)
    if (r.status !== 'ok' && r.fix) lines.push(`         fix: ${r.fix.replace(/\n\s*/g, '\n              ')}`)
  }
  return lines.join('\n')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const args = process.argv.slice(2)
  const dirArg = args.indexOf('--ios-dir')
  const iosDir = dirArg >= 0 ? resolve(args[dirArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..', 'android_app', 'ios')

  if (args.includes('--apply')) {
    try {
      const changed = applyFixes({ iosDir })
      console.log(changed.length ? changed.map(c => `applied: ${c}`).join('\n') : 'nothing to apply: already wired in')
      console.log()
    } catch (e) {
      console.error(`Could not apply: ${e.message}\n`)
    }
  }

  const results = checkAll({ iosDir })
  console.log('iOS readiness\n')
  console.log(render(results))
  const failed = results.filter(r => r.status === 'fail').length
  const blocked = results.filter(r => r.status === 'blocked').length
  const warned = results.filter(r => r.status === 'warn').length
  console.log(`\n${results.length - failed - blocked - warned} ok, ${failed} blocking, ${blocked} waiting on an earlier step, ${warned} for you to do on the Mac`)
  process.exit(failed ? 1 : 0)
}
