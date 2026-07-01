import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { collectionGroup, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth'
import { useUsers } from './users'
import { listenMyDmConvos } from './db'

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

export function NotificationDaemon() {
  const { profile } = useAuth()
  const { byId } = useUsers()
  const { permission } = useNotifications()

  // Timestamp at mount: only messages newer than this trigger notifications.
  const baselineRef = useRef(Date.now())
  // Dedupe: track last notified createdAt per source key.
  const lastByKey = useRef(new Map())

  // Reset baseline whenever profile changes (sign in/out).
  useEffect(() => { baselineRef.current = Date.now(); lastByKey.current.clear() }, [profile?.id])

  const shouldNotify = () =>
    supported && permission === 'granted'
    && (document.hidden || !document.hasFocus())

  const fire = ({ key, title, body, icon, path }) => {
    if (!shouldNotify()) return
    if (lastByKey.current.get(key) === (body + '|' + path)) return
    lastByKey.current.set(key, body + '|' + path)
    try {
      const n = new Notification(title, {
        body: stripTokens(body),
        icon,
        tag: key,
        silent: false,
      })
      n.onclick = () => {
        window.focus()
        if (path) window.location.assign(path)
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
        const author = byId[dm.lastMessageAuthorUid]
        fire({
          key: `dm:${dm.id}`,
          title: author?.name || 'New message',
          body: dm.lastMessageText || '',
          icon: author?.photoURL || undefined,
          path: `/dms/${dm.lastMessageAuthorUid}`,
        })
      })
    })
  }, [profile?.id, byId, permission])

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
