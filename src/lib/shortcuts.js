// The keyboard shortcuts sheet: what it lists, and when "?" opens it. Pure, so it is tested.
//
// Every entry here is a shortcut that really exists, and tests/shortcuts.test.mjs pins each
// one to the code that handles it (the quick switcher's key, unreadKeyDirection, shouldSend),
// so the sheet cannot say something the app does not do. If a shortcut is added or changed,
// this list is where it is written down for people.

/** Asks for the sheet from somewhere else (the preferences dialog). */
export const OPEN_SHORTCUTS_EVENT = 'punx:shortcuts'

/** A Mac, iPhone or iPad: where Cmd, not Ctrl, is the modifier and Option is called Option. */
export function isMacPlatform(platform) {
  return /mac|iphone|ipad|ipod/i.test(String(platform ?? ''))
}

/** The keys of one shortcut as they are written on this platform. 'mod' is Cmd on a Mac, Ctrl elsewhere. */
export function keyLabels(keys, mac) {
  return (keys || []).map((k) => {
    if (k === 'mod') return mac ? '⌘' : 'Ctrl'
    if (k === 'Alt' && mac) return '⌥'
    return k
  })
}

/**
 * The groups of shortcuts to show. Sending depends on the person's own setting
 * ("Send a message with" in the preferences), so the Writing group follows it.
 * An item is `keys` (pressed together), with an optional `or` (another way to do it).
 */
export function shortcutGroups({ sendKey = 'enter' } = {}) {
  const send = sendKey === 'mod-enter'
    ? [
        { id: 'send', keys: ['mod', 'Enter'], does: 'Send the message' },
        { id: 'newline', keys: ['Enter'], does: 'Start a new line' },
      ]
    : [
        { id: 'send', keys: ['Enter'], does: 'Send the message' },
        { id: 'newline', keys: ['Shift', 'Enter'], does: 'Start a new line' },
      ]
  return [
    {
      title: 'Move around',
      items: [
        { id: 'switcher', keys: ['mod', 'K'], does: 'Jump to any conversation or person' },
        { id: 'next-unread', keys: ['Alt', 'Shift', '↓'], does: 'Open the conversation that has been waiting longest' },
        { id: 'prev-unread', keys: ['Alt', 'Shift', '↑'], does: 'Open the newest unread conversation' },
      ],
    },
    {
      title: 'Writing',
      items: [
        ...send,
        { id: 'mention-move', keys: ['↑'], or: ['↓'], does: 'Move through the list when you type @' },
        { id: 'mention-pick', keys: ['Enter'], or: ['Tab'], does: 'Pick the person highlighted' },
      ],
    },
    {
      title: 'Anywhere',
      items: [
        { id: 'close', keys: ['Esc'], does: 'Close a box, picker or pop-up' },
        { id: 'help', keys: ['?'], does: 'Show or hide this list' },
      ],
    },
  ]
}

/**
 * Does this key press ask for the sheet? A "?" typed while not in a text field, with no
 * Ctrl, Cmd or Alt held (Shift is how "?" is typed on most keyboards, so it is allowed),
 * and not part of an input method composing text.
 */
export function shouldOpenHelp(e) {
  if (!e || e.key !== '?') return false
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
  const t = e.target
  const tag = String(t?.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
  if (t?.isContentEditable) return false
  return true
}
