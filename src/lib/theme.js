// Light/dark, as a single class on <html>.
//
// Switching costs one classList call and no re-render: every colour in the app
// resolves through CSS variables (see src/index.css and tailwind.config.js), so
// the browser repaints on its own. That is the one real advantage the web has
// over the Flutter client here, where the same change has to rebuild the tree
// because widgets read colour values rather than referencing them.
//
// The choice itself now lives with the rest of the person's preferences (see
// src/lib/prefs.js): kept on the device and in their account, and one of three
// settings (Auto follows the device). These functions are the quick light/dark
// switch in the user menu, and keep their old shape.

import { prefsStore } from './prefsStore'

/** Is the light theme showing right now (whether chosen or followed from the device)? */
export function isLight() {
  return document.documentElement.classList.contains('light')
}

export function setLight(light) {
  prefsStore.set({ theme: light ? 'light' : 'dark' })
}

export function toggleTheme() {
  const next = !isLight()
  setLight(next)
  return next
}
