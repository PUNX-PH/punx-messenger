// The live preferences: held in memory, kept on this device, applied to the page,
// and announced to anything that cares (the settings screen, the account sync).
//
// The page-wide look is applied here directly (variables and attributes on <html>),
// not through React, so changing a colour costs no re-render and appears at once.
//
// Kept on the device in two forms: the preferences themselves, and a ready-made
// snapshot of what they do to the page (prefs.js computeSnapshot). The snapshot is
// what the small script in index.html reads before the app starts, so the page opens
// in the right colours instead of flashing the default ones first.

import {
  DEFAULT_PREFS, READABLE_FONT_URL, applySnapshot, computeSnapshot, newerPrefs, normalizePrefs,
} from './prefs.js'

export const PREFS_KEY = 'punx.prefs'
export const SNAPSHOT_KEY = 'punx.prefsCss'
const LEGACY_THEME_KEY = 'themeMode' // the old light/dark switch (and the Android app's key)

const safe = (fn, fallback) => { try { return fn() } catch { return fallback } }

/**
 * @param {object} env everything outside the code, so a test can supply stand-ins:
 *   storage (localStorage), root (<html>), matchMedia, now, loadFont
 */
export function createPrefsStore(env = {}) {
  const storage = env.storage ?? null
  const root = env.root ?? null
  const now = env.now ?? (() => Date.now())
  const media = safe(() => env.matchMedia?.('(prefers-color-scheme: light)'), null)

  let state = load()
  let syncStatus = 'idle' // 'idle' | 'saving' | 'saved' | 'error': the account copy, for the settings screen
  const listeners = new Set()
  const syncListeners = new Set()
  const changeListeners = new Set() // for the account sync: local changes only

  function load() {
    const saved = safe(() => storage?.getItem(PREFS_KEY), null)
    if (saved) {
      const parsed = safe(() => JSON.parse(saved), null)
      if (parsed) return normalizePrefs(parsed)
    }
    // First time on this version: keep the light/dark choice the person had.
    if (safe(() => storage?.getItem(LEGACY_THEME_KEY), null) === 'light') {
      return normalizePrefs({ ...DEFAULT_PREFS, theme: 'light' })
    }
    return normalizePrefs(DEFAULT_PREFS)
  }

  function persist() {
    safe(() => storage?.setItem(PREFS_KEY, JSON.stringify(state)))
    safe(() => storage?.setItem(SNAPSHOT_KEY, JSON.stringify(computeSnapshot(state))))
  }

  const loadedFonts = new Set()
  function ensureFont() {
    if (state.font !== 'readable' || loadedFonts.has('readable')) return
    loadedFonts.add('readable')
    env.loadFont?.(READABLE_FONT_URL)
  }

  function apply() {
    if (!root) return false
    const light = applySnapshot(computeSnapshot(state), root, { systemLight: !!media?.matches })
    ensureFont()
    return light
  }

  function notify() { listeners.forEach(fn => fn()) }

  // "Auto" follows the device, which can change while the app is open.
  media?.addEventListener?.('change', () => { if (state.theme === 'auto') { apply(); notify() } })

  const store = {
    get: () => state,

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },

    /** For the account sync: told only about changes made here, not ones adopted. */
    onLocalChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn) },

    /** Change some choices. Returns the new preferences. */
    set(patch) {
      state = normalizePrefs({ ...state, ...patch, updatedAt: now() })
      persist(); apply(); notify()
      changeListeners.forEach(fn => fn(state))
      return state
    },

    /** Back to the defaults (which is itself a change, so it reaches the account). */
    reset() {
      state = normalizePrefs({ ...DEFAULT_PREFS, updatedAt: now() })
      persist(); apply(); notify()
      changeListeners.forEach(fn => fn(state))
      return state
    },

    /**
     * Back to the defaults WITHOUT counting as a change: for when a different person
     * signs in on this browser and must not inherit the last one's look. Nothing is
     * sent to any account.
     */
    resetLocal() {
      state = normalizePrefs(DEFAULT_PREFS)
      persist(); apply(); notify()
      return state
    },

    /** Whether the account copy is being saved, saved, or could not be. */
    getSyncStatus: () => syncStatus,
    setSyncStatus(status) {
      if (status === syncStatus) return
      syncStatus = status
      syncListeners.forEach(fn => fn())
    },
    subscribeSync(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn) },

    /**
     * The account's copy arrived (at sign-in, or changed on another device). Keeps
     * whichever was changed last. Not announced as a local change, so it is not sent
     * straight back.
     * @returns {boolean} whether it replaced what this device had
     */
    adoptRemote(remote) {
      const { prefs, from } = newerPrefs(state, remote)
      if (from !== 'remote') return false
      state = prefs
      persist(); apply(); notify()
      return true
    },

    /** Put the saved choices on the page. Called once at start-up. */
    apply,
  }
  return store
}

/** The one the app uses, wired to the real browser. Created only where there is one. */
export const prefsStore = createPrefsStore(
  typeof window === 'undefined' ? {} : {
    storage: safe(() => window.localStorage, null),
    root: document.documentElement,
    matchMedia: (q) => window.matchMedia?.(q),
    loadFont: (url) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      document.head.appendChild(link)
    },
  },
)
