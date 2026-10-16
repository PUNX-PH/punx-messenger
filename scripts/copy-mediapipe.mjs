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
// Called from vite.config.js, so it runs on EVERY build and dev start however
// Vite is started. It used to be an npm "prebuild" hook, which a host that runs
// `vite build` directly never fires: the site went live with the blur code and
// without the model, and the files answered with the app's HTML. It can still be
// run by hand: `node scripts/copy-mediapipe.mjs`. public/mediapipe/ is not
// committed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['README.md', 'index.d.ts', 'package.json'])

/**
 * @returns {{ copied: number, missing: boolean }} `missing` when the package is not
 *   installed (not fatal: the app works, the blur button reports it is unavailable).
 */
export function copyMediapipe({ log = console } = {}) {
  const from = path.join(root, 'node_modules', '@mediapipe', 'selfie_segmentation')
  const to = path.join(root, 'public', 'mediapipe')
  if (!fs.existsSync(from)) {
    log.warn('[mediapipe] @mediapipe/selfie_segmentation is not installed; background blur will be unavailable.')
    return { copied: 0, missing: true }
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
  log.log(`[mediapipe] ${copied ? `copied ${copied} file(s) to` : 'up to date in'} public/mediapipe`)
  return { copied, missing: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) copyMediapipe()
