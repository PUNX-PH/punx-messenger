// The preferences as React state: [prefs, setPrefs, resetPrefs]. Anything that
// changes with a preference (message times, the send key, the tab title) reads it
// here and re-renders when it changes; the page-wide look does not need this, it is
// applied to <html> directly by prefsStore.
import { useSyncExternalStore } from 'react'
import { prefsStore } from './prefsStore'

export function usePrefs() {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get, prefsStore.get)
  return [prefs, prefsStore.set, prefsStore.reset]
}

/** 'idle' | 'saving' | 'saved' | 'error': whether the account has the latest copy. */
export function useSyncStatus() {
  return useSyncExternalStore(prefsStore.subscribeSync, prefsStore.getSyncStatus, prefsStore.getSyncStatus)
}
