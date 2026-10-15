import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { collectionGroup, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from './firebase'
import { useAuth } from './auth'
import { useUsers } from './users'
import { listenMyDmConvos } from './db'
import { play as playSfx } from './sfx'

// ────────────────── Permission context ──────────────────

const supported = typeof Notification !== 'undefined'

const NotifCtx = createContext({
  supported,
  permission: supported ? Notification.permission : 'unsupported',
  request: async () => 'denied',
})

export function NotificationsProvider({ children }) {
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported')

  // Firefox / Chrome may not always fire a "permissionchange" event, so poll a bit
  useEffect(() => {
    if (!supported) return
    const t = setInterval(() => {
      if (Notification.permission !== permission) setPermission(Notification.permission)
    }, 3000)
    return () => clearInterval(t)
  }, [permission])

  const request = async () => {
    if (!supported) return 'unsupported'
    try {
      const p = await Notification.requestPermission()
      setPermission(p)
      return p
    } catch { return 'denied' }
  }

  return (
    <NotifCtx.Provider value={{ supported, permission, request }}>
      {children}
    </NotifCtx.Provider>
  )
}

export const useNotifications = () => useContext(NotifCtx)

// ────────────────── Daemon: listen + fire OS notifications ──────────────────

const MAX_BODY_LEN = 140
const stripTokens = (t) => (t || '')
  .replace(/<@[A-Za-z0-9_-]+>/g, '@someone')
  .replace(/```[\s\S]*?```/g, '[code]')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/[*_~]/g, '')
  .slice(0, MAX_BODY_LEN)

/** True when this exact route is open in a tab you are actively using. */
const isLookingAt = (path) =>
  !!path && document.visibilityState === 'visible' && document.hasFocus()
  && window.location.pathname === path

export function NotificationDaemon() {
  const { profile } = useAuth()
  const { byId } = useUsers()
  const { permission } = useNotifications()
  const navigate = useNavigate()
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  // Timestamp at mount: only messages newer than this trigger notifications.
  const baselineRef = useRef(Date.now())
  // Dedupe: track last notified createdAt per source key.
  const lastByKey = useRef(new Map())

  // Reset baseline whenever profile changes (sign in/out).
  useEffect(() => { baselineRef.current = Date.now(); lastByKey.current.clear() }, [profile?.id])

  const shouldNotify = () =>
    supported && permission === 'granted'
    && (document.hidden || !document.hasFocus())

  // `stamp` identifies the MESSAGE (its timestamp or id), so the same message is
  // never announced twice and two identical ones ("ok", "ok") both are. It used
  // to be the body text, which dropped the second "ok"; and it was recorded only
  // after the focus check below, so everything that arrived while the tab was in
  // front was still "new" the moment you left, and replayed as a burst.
  const fire = ({ key, stamp, title, body, icon, path, sound }) => {
    if (lastByKey.current.get(key) === stamp) return
    lastByKey.current.set(key, stamp)
    // The ping is independent of the OS notification: it plays with the tab in
    // front too, because that is when you are most likely to be using the app
    // with the sound on. The one exception is the conversation you are looking
    // at — it is already on screen, and pinging for it would be noise.
    if (sound && !isLookingAt(path)) playSfx('dm_ping')
    if (!shouldNotify()) return
    try {
      const n = new Notification(title, {
        body: stripTokens(body),
        icon,
        tag: key,
        silent: false,
      })
      n.onclick = () => {
        window.focus()
        // A router navigation, not location.assign: a full reload tears down
        // whatever call or voice session is in progress.
        if (path) navigate(path)
        n.close()
      }
    } catch { /* noop */ }
  }

  // ── DMs → notify on new incoming messages ──
  useEffect(() => {
    if (!profile?.id) return
    return listenMyDmConvos(profile.id, (byOther) => {
      Object.values(byOther).forEach(dm => {
        const ts = dm.lastMessageAt?.toMillis?.() ?? 0
        if (ts <= baselineRef.current) return
        if (!dm.lastMessageAuthorUid) return
        if (dm.lastMessageAuthorUid === profile.uid) return
        const author = byIdRef.current[dm.lastMessageAuthorUid]
        fire({
          key: `dm:${dm.id}`,
          stamp: String(ts),
          title: author?.name || 'New message',
          body: dm.lastMessageText || '',
          icon: author?.photoURL || undefined,
          path: `/dms/${dm.lastMessageAuthorUid}`,
          sound: true,
        })
      })
    })
    // Not `byId`: the directory changes with every presence heartbeat anyone
    // sends, and each change tore this subscription down and rebuilt it — which
    // replays every conversation. It is read through a ref instead.
  }, [profile?.id, permission])

  // ── Channel @mentions → notify when someone mentions me ──
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(
      collectionGroup(db, 'messages'),
      where('mentionedUids', 'array-contains', profile.uid),
      orderBy('createdAt', 'desc'),
      limit(20),
    )
    return onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'removed') return
        const m = change.doc.data()
        if (m.author?.uid === profile.uid) return
        const ts = m.createdAt?.toMillis?.() ?? 0
        if (ts <= baselineRef.current) return

        const parts = change.doc.ref.path.split('/')
        // Only channel messages go here — DMs are handled by the DM listener above.
        if (parts[0] !== 'groups') return
        // parts = ['groups', gid, 'channels', cid, 'messages', mid]
        const path = `/g/${parts[1]}/c/${parts[3]}`

        fire({
          key: `mention:${change.doc.id}`,
          stamp: change.doc.id,
          title: `${m.author?.name || 'Someone'} mentioned you`,
          body: m.text || (m.imageURL ? '[image]' : ''),
          icon: m.author?.photoURL || undefined,
          path,
        })
      })
    }, (err) => {
      // If the composite index doesn't exist yet, log a helpful hint.
      if (err?.code === 'failed-precondition') {
        console.info('[Notifications] Firestore wants a collection-group index for mentions.\n' +
          'Open the URL in the error above and click "Create index":\n', err.message)
      }
    })
  }, [profile?.uid, permission])

  return null
}
