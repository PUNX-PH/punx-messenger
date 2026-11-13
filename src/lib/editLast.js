// "Edit your last message" with the up arrow, from an empty message box. Pure, so it is tested.
//
// The key is only taken when it cannot mean anything else: a plain up arrow, in an empty box
// (so it would only move the caret nowhere), with no picture waiting to be sent, no @ list
// open (that list uses the up arrow itself) and no input method composing text.

/**
 * Does this key press ask to edit the last message?
 * `text` is what is in the box, `hasFile` whether a picture or file is attached,
 * `mentionOpen` whether the list of people for @ is showing.
 */
export function shouldEditLast(e, { text = '', hasFile = false, mentionOpen = false } = {}) {
  if (!e || e.key !== 'ArrowUp') return false
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
  if (e.defaultPrevented) return false
  if (hasFile || mentionOpen) return false
  return String(text ?? '').trim() === ''
}

/**
 * The message the up arrow edits: the newest one of mine that has text to edit. A picture
 * on its own has none (the edit button is not offered on it either), so it is skipped.
 * `messages` is oldest first, as the chat holds them. null when there is none.
 */
export function lastEditableMessage(messages, meUid) {
  if (!meUid || !Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.author?.uid !== meUid) continue
    if (typeof m.text === 'string' && m.text.trim() !== '') return m
  }
  return null
}
