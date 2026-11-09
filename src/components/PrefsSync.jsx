import { useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { prefsStore } from '../lib/prefsStore'
import { isDefault } from '../lib/prefs'

const OWNER_KEY = 'punx.prefsOwner' // whose preferences this browser is holding
const SAVE_DELAY_MS = 800           // wait for a pause: dragging a colour picker fires dozens

const safe = (fn) => { try { return fn() } catch { return undefined } }

/**
 * Keeps the preferences on this device and in the person's account the same, so a
 * look chosen on one computer follows them to the next. Renders nothing; mounted
 * once, beside the routes, while signed in.
 *
 * The copy is a `prefs` field on the person's own users/{uid} document, which the
 * rules already let them write (nothing in the rules needed to change).
 */
export default function PrefsSync() {
  const { profile } = useAuth()
  const { byId } = useUsers()
  const meId = profile?.id
  // The live copy once the directory has loaded; the one read at sign-in before that.
  const remote = byId[meId]?.prefs ?? profile?.prefs

  // 1. A different person signing in on this browser starts from the defaults, not
  //    from whatever the last person chose. (Declared first: effects run in order.)
  useEffect(() => {
    if (!meId) return
    const owner = safe(() => localStorage.getItem(OWNER_KEY))
    if (owner && owner !== meId) prefsStore.resetLocal()
    safe(() => localStorage.setItem(OWNER_KEY, meId))
  }, [meId])

  // 2. Take the account's copy if it is newer than this device's. If the account has
  //    none yet but this device has choices (made before this existed, or before
  //    signing in), keep them and save them to the account.
  useEffect(() => {
    if (!meId) return
    if (remote) prefsStore.adoptRemote(remote)
    else if (!isDefault(prefsStore.get())) prefsStore.set({})
  }, [meId, remote])

  // 3. Save changes made here to the account, after a pause in changing things.
  useEffect(() => {
    if (!meId) return
    let timer
    const off = prefsStore.onLocalChange((prefs) => {
      prefsStore.setSyncStatus('saving')
      clearTimeout(timer)
      timer = setTimeout(() => {
        setDoc(doc(db, 'users', meId), { prefs }, { merge: true })
          .then(() => prefsStore.setSyncStatus('saved'))
          .catch((err) => {
            console.warn('[prefs] could not save to your account:', err?.message || err)
            prefsStore.setSyncStatus('error')
          })
      }, SAVE_DELAY_MS)
    })
    return () => { off(); clearTimeout(timer) }
  }, [meId])

  return null
}
