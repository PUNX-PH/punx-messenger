// "Copy text" on a message. Pure, so it is tested; the clipboard itself is in clipboard.js.
//
// What is copied is what the person would paste into a message of their own: the text as it was
// written (so **bold** and `code` still work when pasted back), but with mentions turned back
// into the names people see, not the internal <@uid> tokens they are stored as.

const MENTION = /<@([A-Za-z0-9_-]{6,40})>/g

/** Shown in place of a mention whose person is not in the directory (left the workspace, not loaded yet): what the message itself shows for it. */
export const UNKNOWN_MENTION = '@Unknown'

/** Does this message have text that can be copied? A picture on its own does not. */
export function hasCopyableText(message) {
  return typeof message?.text === 'string' && message.text.trim() !== ''
}

/** The text to put on the clipboard for a message: its text with each mention written as @Name. '' when there is none. */
export function copyableText(message, usersById = {}) {
  if (!hasCopyableText(message)) return ''
  return message.text
    .replace(MENTION, (_, uid) => {
      const name = usersById?.[uid]?.name
      return typeof name === 'string' && name.trim() ? '@' + name.trim() : UNKNOWN_MENTION
    })
    .trim()
}
