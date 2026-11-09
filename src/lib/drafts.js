// Unsent message text, kept per conversation.
//
// Why this exists. The composer is one component that stays mounted while you move
// between channels and DMs, so whatever you had typed stayed in the box when you
// opened another conversation, and sending it posted it THERE. Drafts fix that
// properly: each conversation has its own, saved as you type and put back when you
// return, and an empty box is what you see in a conversation you have not typed in.
//
// Kept for the life of the browser tab (sessionStorage) so a reload does not lose
// a long message, and never longer: closing the tab or signing out drops them, so a
// shared computer does not show one person's half-written message to the next.
//
// The storage is passed in so tests can use a plain object.

const STORAGE_KEY = 'punx.drafts'
const MAX_DRAFTS = 50      // oldest-touched go first
const MAX_CHARS = 20_000   // far beyond any message; stops one runaway paste filling storage
const SAVE_DELAY_MS = 400  // typing is bursty: write storage once it pauses

function defaultStorage() {
  try { return globalThis.sessionStorage } catch { return null }
}

export function createDraftStore({ storage = defaultStorage(), delay = SAVE_DELAY_MS } = {}) {
  let drafts = load()
  let timer = null

  function load() {
    try {
      const raw = storage?.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const map = new Map()
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && v.trim()) map.set(k, v)
      }
      return map
    } catch { return new Map() }
  }

  function flush() {
    clearTimeout(timer)
    timer = null
    try {
      if (drafts.size) storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)))
      else storage?.removeItem(STORAGE_KEY)
    } catch { /* storage full or blocked: drafts still work for this page, just not across a reload */ }
  }

  function scheduleSave() {
    if (delay <= 0) { flush(); return }
    clearTimeout(timer)
    timer = setTimeout(flush, delay)
  }

  return {
    /** The saved text for a conversation, or '' if there is none. */
    get(key) { return key ? (drafts.get(key) ?? '') : '' },

    /** Save what is in the box now. Empty (or only spaces) means no draft. */
    set(key, text) {
      if (!key) return
      if (typeof text !== 'string' || !text.trim()) { this.clear(key); return }
      drafts.delete(key)                        // re-inserting makes it the newest
      drafts.set(key, text.slice(0, MAX_CHARS))
      while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value)
      scheduleSave()
    },

    clear(key) {
      if (key && drafts.delete(key)) scheduleSave()
    },

    /** Everything: for signing out. Written through at once, not after a delay. */
    clearAll() {
      drafts = new Map()
      flush()
    },

    /** Write to storage now (the page is closing, or a test). */
    flush,
  }
}

/** The one the app uses. */
export const drafts = createDraftStore()

// A tab being closed or sent to the background may never run a pending timer.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => drafts.flush())
}
