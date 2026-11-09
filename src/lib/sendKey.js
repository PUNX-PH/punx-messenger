// Which key press sends the message. Pure, so it is tested.
//
// "enter" (the default): Enter sends, Shift+Enter is a new line.
// "mod-enter": Ctrl+Enter (or Cmd+Enter) sends, and plain Enter is a new line, for
// people who write longer messages and keep sending by accident.
//
// Enter while an input method is composing (Japanese, Chinese, Korean) confirms the
// candidate and must never also send; that holds in both settings.

export function shouldSend(event, sendKey = 'enter') {
  if (event.key !== 'Enter') return false
  if (event.isComposing || event.nativeEvent?.isComposing) return false
  if (sendKey === 'mod-enter') return !!(event.ctrlKey || event.metaKey)
  return !event.shiftKey
}
