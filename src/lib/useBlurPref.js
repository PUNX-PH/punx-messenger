// The "blur my background" choice as React state, shared by everything that shows
// or uses it: the voice-channel hook, the 1:1 call hook and both buttons. They
// are separate components that could each hold their own copy and drift apart,
// so there is one value, kept in localStorage, and this announces changes to it.
import { useSyncExternalStore } from 'react'
import { loadBlurPref, saveBlurPref } from './camera'
import { blurSupported } from './backgroundBlur'

const listeners = new Set()
const subscribe = (fn) => {
  listeners.add(fn)
  // Another tab changing it counts too.
  window.addEventListener('storage', fn)
  return () => { listeners.delete(fn); window.removeEventListener('storage', fn) }
}
const read = () => blurSupported() && loadBlurPref()

export function setBlurPref(on) {
  saveBlurPref(on)
  listeners.forEach((fn) => fn())
}

/** Whether background blur is wanted (and possible here). */
export const getBlurPref = read
export const useBlurPref = () => useSyncExternalStore(subscribe, read, () => false)
