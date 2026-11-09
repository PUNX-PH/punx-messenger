// The security headers the site sends, and that they cannot quietly break calling.
//
//   node --test tests/security-headers.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
const allPaths = vercel.headers.find(h => h.source === '/(.*)')
const fromVercel = Object.fromEntries((allPaths?.headers || []).map(h => [h.key, h.value]))

// public/_headers: "/*" followed by indented "Name: value" lines.
function cloudflareBlock(path) {
  const lines = fs.readFileSync('public/_headers', 'utf8').split(/\r?\n/)
  const start = lines.findIndex(l => l.trim() === path)
  if (start < 0) return null
  const out = {}
  for (const l of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(l)) break
    const i = l.indexOf(':')
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  return out
}
const fromCloudflare = cloudflareBlock('/*')

const policy = (value) => Object.fromEntries(
  value.split(',').map(p => p.trim()).map(p => { const m = p.match(/^([a-z-]+)=\((.*)\)$/); return [m[1], m[2].trim()] }),
)

test('the headers are set for every path on Vercel', () => {
  assert.ok(allPaths, 'a rule for "/(.*)" exists')
  for (const key of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(fromVercel[key], key)
  }
})

test('nosniff, no framing, and only the origin goes to other sites', () => {
  assert.equal(fromVercel['X-Content-Type-Options'], 'nosniff')
  assert.equal(fromVercel['X-Frame-Options'], 'DENY')
  // Invite links carry a secret in the path; it must never reach another site.
  assert.equal(fromVercel['Referrer-Policy'], 'strict-origin-when-cross-origin')
})

test('calling still works: camera, microphone and screen capture stay allowed for this site', () => {
  const p = policy(fromVercel['Permissions-Policy'])
  for (const feature of ['camera', 'microphone', 'display-capture']) {
    assert.equal(p[feature], 'self', `${feature} must be (self), or calls, blur and screen share break`)
  }
})

test('features the app never uses are switched off', () => {
  const p = policy(fromVercel['Permissions-Policy'])
  for (const feature of ['geolocation', 'payment', 'usb']) assert.equal(p[feature], '', feature)
})

test('nothing that would break the Google sign-in popup is set', () => {
  assert.equal('Cross-Origin-Opener-Policy' in fromVercel, false)
})

test('the built-file cache rule is still there, and is not overridden by the new rule', () => {
  const assets = vercel.headers.find(h => h.source === '/assets/(.*)')
  assert.ok(assets)
  assert.deepEqual(assets.headers, [{ key: 'Cache-Control', value: 'public, max-age=86400' }])
  assert.equal('Cache-Control' in fromVercel, false, 'the all-paths rule must not set Cache-Control (index.html must revalidate)')
})

test('the single-page-app rewrite is untouched', () => {
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
})

test('public/_headers (Cloudflare) sends exactly the same headers as Vercel', () => {
  assert.ok(fromCloudflare, 'a "/*" block exists in public/_headers')
  assert.deepEqual(fromCloudflare, fromVercel)
})
