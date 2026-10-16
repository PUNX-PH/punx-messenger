import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyMediapipe } from './scripts/copy-mediapipe.mjs'

// Third-party libraries get their own files, apart from the app's own code.
//
// Built files are named by a hash of their contents and cached "forever", so a
// returning visitor re-downloads only the files whose contents changed. With
// everything in one file, every deploy — even a one-line fix — changed that file
// and sent the whole 900 KB again, of which about two thirds was Firebase and
// React, which had not changed at all. Split out, a typical deploy re-sends only
// the app's own code.
const vendorChunk = (id) => {
  if (!id.includes('node_modules')) return undefined
  if (/node_modules\/(@?firebase|@firebase|idb|tslib)\//.test(id)) return 'firebase'
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run)\//.test(id)) return 'react'
  return undefined // anything else stays with the code that uses it
}

// Puts the background-blur model in public/ before Vite reads it, on every dev start
// and every build, whatever command started Vite (see scripts/copy-mediapipe.mjs for
// why this is not an npm "prebuild" hook).
const blurModel = { name: 'blur-model', config: () => { copyMediapipe() } }

export default defineConfig({
  plugins: [react(), blurModel],
  server: { port: 5173, host: true },
  build: {
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
})
