// Copies the background-blur model and its WebAssembly runtime from node_modules
// into public/mediapipe/, so the app serves them from its own origin.
//
// Why from our own origin, and why not imported: the package is a classic script
// that bundlers handle badly (it fails in a production Vite build), and the model
// has to be fetched at runtime by the script itself. Serving it from here also
// means a call never depends on a third-party CDN being reachable. Nothing is
// downloaded unless someone turns background blur on; the files are about 12 MB
// in all, but a browser fetches only the runtime variant it can run.
//
// Runs before `dev` and `build` (see package.json). public/mediapipe/ is not
// committed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'node_modules', '@mediapipe', 'selfie_segmentation')
const to = path.join(root, 'public', 'mediapipe')
const SKIP = new Set(['README.md', 'index.d.ts', 'package.json'])

if (!fs.existsSync(from)) {
  // Not fatal: the app works without it, the blur button just reports that blur
  // is unavailable. Say so loudly enough that a missing install is noticed.
  console.warn('[mediapipe] @mediapipe/selfie_segmentation is not installed; background blur will be unavailable.')
  process.exit(0)
}

fs.mkdirSync(to, { recursive: true })
let copied = 0
for (const name of fs.readdirSync(from)) {
  if (SKIP.has(name)) continue
  const src = path.join(from, name)
  const dst = path.join(to, name)
  const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size
  if (same) continue
  fs.copyFileSync(src, dst)
  copied++
}
console.log(`[mediapipe] ${copied ? `copied ${copied} file(s) to` : 'up to date in'} public/mediapipe`)
