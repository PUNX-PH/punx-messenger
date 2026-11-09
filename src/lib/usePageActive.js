// Is the person actually looking at this page right now?
//
// Visible AND focused: a visible tab on a second monitor, with the keyboard
// elsewhere, is not being read. Same test the notifications use (isLookingAt in
// notifications.jsx). Changes are announced by the browser, so this costs nothing
// while nothing changes.
import { useSyncExternalStore } from 'react'

function subscribe(onChange) {
  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
  }
}
const read = () => document.visibilityState === 'visible' && document.hasFocus()

export const usePageActive = () => useSyncExternalStore(subscribe, read, () => true)
