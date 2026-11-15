// Several pictures in one go: which files are accepted, and sending them one after another.
//
// A picture is stored inside its message (there is no file storage), and a message document can
// hold about 1 MB, so two pictures cannot share one. Each picture is therefore its own message, in
// the order they were chosen. What was typed goes with the first, and a reply quote with the first.

export const MAX_FILES = 10
export const MAX_BYTES = 10 * 1024 * 1024 // 10 MB, each

export const isImageFile = (f) => !!f && typeof f.type === 'string' && f.type.startsWith('image/')

// The same file chosen twice (picked, then dropped again) is one attachment.
const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * Add `incoming` to the attachments already waiting.
 * Returns { files, problem }: the new list, and one sentence about whatever was left out (or null).
 * Order is kept (what was there, then what came in); nothing already there is ever dropped.
 */
export function addAttachments(current, incoming) {
  const files = [...(current || [])]
  let notImages = 0
  let tooBig = 0
  let tooMany = 0
  for (const f of incoming || []) {
    if (!f) continue
    if (!isImageFile(f)) { notImages++; continue }
    if (f.size > MAX_BYTES) { tooBig++; continue }
    if (files.some(x => sameFile(x, f))) continue
    if (files.length >= MAX_FILES) { tooMany++; continue }
    files.push(f)
  }
  const parts = []
  if (notImages) parts.push(`${notImages} ${notImages === 1 ? 'file is not an image' : 'files are not images'} (only images for now)`)
  if (tooBig) parts.push(`${plural(tooBig, 'image is', 'images are')} over 10 MB`)
  if (tooMany) parts.push(`${plural(tooMany, 'image', 'images')} left out: at most ${MAX_FILES} at a time`)
  return { files, problem: parts.length ? `${parts.join('; ')}.` : null }
}

/** Is a drag carrying files (and not, say, selected text)? Looks at the types only: the files are hidden until the drop. */
export function dragHasFiles(dataTransfer) {
  const types = dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

/** The files in a drop, or on the clipboard, as a plain array (images only are kept later, by addAttachments). */
export function filesOf(dataTransfer) {
  return Array.from(dataTransfer?.files || [])
}

/** The images on the clipboard (a screenshot, a copied picture), as files. */
export function pastedImages(clipboardData) {
  return Array.from(clipboardData?.items || [])
    .filter(i => i && i.kind !== 'string' && typeof i.type === 'string' && i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter(Boolean)
}

/**
 * Send what is waiting. `send({ text, imageFile, followUp })` sends one message.
 *  - nothing attached: one message with the text;
 *  - pictures: one message each, in order; the text rides on the first; `followUp` is true after it.
 * Stops at the first failure and says how far it got, so the rest can be kept for another try:
 * { sent, error } with `sent` the number of messages that went, `error` null when all did.
 * `onProgress(done, total)` is called before each message goes.
 */
export async function sendAttachments({ text, files, send, onProgress }) {
  const list = files || []
  if (list.length === 0) {
    try { await send({ text, imageFile: null, followUp: false }) } catch (error) { return { sent: 0, error } }
    return { sent: 1, error: null }
  }
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i, list.length)
    try {
      await send({ text: i === 0 ? text : '', imageFile: list[i], followUp: i > 0 })
    } catch (error) {
      return { sent: i, error }
    }
  }
  return { sent: list.length, error: null }
}

/** What is left to send after `sent` pictures went: the rest, in order. */
export const remainingAfter = (files, sent) => (files || []).slice(Math.max(0, sent))

/** The box's hint while sending: "Uploading…" for one, "Uploading 2 of 5…" for several. */
export function uploadingText(done, total) {
  return total > 1 ? `Uploading ${Math.min(done + 1, total)} of ${total}…` : 'Uploading…'
}
