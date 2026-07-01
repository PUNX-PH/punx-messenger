import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth'

// Timings
const HEARTBEAT_MS   = 45_000              // write lastSeen every 45s while active
const IDLE_AFTER_MS  = 5 * 60_000          // 5 min of no activity → idle
const OFFLINE_AFTER_MS = 2 * 60_000        // no heartbeat within 2 min → treat as offline
const TICK_MS        = 30_000              // re-render presence dots every 30s

// ---------- Heartbeat: writes my presence + lastSeen ----------

export function PresenceHeartbeat() {
  const { profile } = useAuth()
  const stateRef = useRef('online')

  useEffect(() => {
    if (!profile?.id) return
    const ref = doc(db, 'users', profile.id)

    const writeState = async (state) => {
      stateRef.current = state
      try {
        await updateDoc(ref, { presence: state, lastSeen: serverTimestamp() })
      } catch { /* non-fatal */ }
    }

    const writeHeartbeat = async () => {
      try { await updateDoc(ref, { lastSeen: serverTimestamp() }) }
      catch { /* non-fatal */ }
    }

    let idleTimer = null
    const armIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => writeState('idle'), IDLE_AFTER_MS)
    }

    const onActivity = () => {
      if (document.visibilityState !== 'visible') return
      if (stateRef.current !== 'online') writeState('online')
      armIdleTimer()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        writeState('online')
        armIdleTimer()
      } else {
        writeState('idle')
        clearTimeout(idleTimer)
      }
    }

    // Best-effort offline write on tab close (may not always fire)
    const onPageHide = () => {
      // Fire-and-forget; rely on staleness cleanup otherwise
      writeState('idle')
    }

    // Initial state
    writeState('online')
    armIdleTimer()

    // Heartbeat interval — only writes when tab is visible + online
    const hbInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && stateRef.current === 'online') {
        writeHeartbeat()
      }
    }, HEARTBEAT_MS)

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      clearTimeout(idleTimer)
      clearInterval(hbInterval)
      events.forEach(ev => window.removeEventListener(ev, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [profile?.id])

  return null
}

// ---------- Tick context: forces UI re-render every 30s so status ages ----------

const TickCtx = createContext(0)

export function PresenceTickProvider({ children }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])
  return <TickCtx.Provider value={now}>{children}</TickCtx.Provider>
}

export const useTickNow = () => useContext(TickCtx)

// ---------- Status computation ----------

/**
 * Compute a user's visible status. `now` is the current time (from useTickNow
 * so status ages between renders).
 */
export function computeStatus(user, now = Date.now()) {
  if (!user) return 'offline'
  const lastSeen = user.lastSeen?.toMillis?.() ?? 0
  const staleness = now - lastSeen
  if (staleness > OFFLINE_AFTER_MS) return 'offline'
  if (user.presence === 'idle') return 'idle'
  return 'online'
}

export function useUserStatus(user) {
  const now = useTickNow()
  return computeStatus(user, now)
}

export const statusLabel = (s) => s === 'online' ? 'Online' : s === 'idle' ? 'Idle' : 'Offline'
