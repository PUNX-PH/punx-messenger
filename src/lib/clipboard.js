// Put text on the clipboard. The modern call is only available on a secure page and can be
// refused (permissions, an embedded frame, some in-app browsers), so there is a fallback that
// selects a hidden text box and uses the old copy command. Returns true when the text was copied,
// false when neither way worked, and never throws: callers show "Copied" or nothing.

export async function copyToClipboard(text, env = globalThis) {
  const value = String(text ?? '')
  if (!value) return false
  try {
    // No navigator, no clipboard, or a refusal all throw here, and all fall through to the old way.
    await env.navigator.clipboard.writeText(value)
    return true
  } catch { /* fall through to the old way */ }
  return legacyCopy(value, env.document)
}

function legacyCopy(value, doc) {
  if (!doc?.body || typeof doc.execCommand !== 'function') return false
  let ta = null
  try {
    ta = doc.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    // Off-screen, and not focus-stealing for longer than the copy itself.
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '-9999px'
    ta.style.opacity = '0'
    const active = doc.activeElement
    doc.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = doc.execCommand('copy') === true
    active?.focus?.()
    return ok
  } catch {
    return false
  } finally {
    ta?.remove?.()
  }
}
