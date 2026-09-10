// Light/dark, as a single class on <html>.
//
// Switching costs one classList call and no re-render: every colour in the app
// resolves through CSS variables (see src/index.css and tailwind.config.js), so
// the browser repaints on its own. That is the one real advantage the web has
// over the Flutter client here, where the same change has to rebuild the tree
// because widgets read colour values rather than referencing them.
//
// Stored per-device rather than on the user's Firestore document: this is a
// property of the screen you are reading on, not of the account, and a
// Firestore round trip would mean opening in the wrong theme and then flipping.
// The key matches the Android app's for consistency; the stores are separate.

const KEY = 'themeMode'

export function isLight() {
  return document.documentElement.classList.contains('light')
}

export function setLight(light) {
  document.documentElement.classList.toggle('light', light)
  try {
    localStorage.setItem(KEY, light ? 'light' : 'dark')
  } catch {
    // Private mode or blocked storage — the choice still holds for this tab.
  }
}

export function toggleTheme() {
  const next = !isLight()
  setLight(next)
  return next
}
