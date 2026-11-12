import { useCallback, useEffect, useState } from 'react'
import LazySlot from './LazySlot'
import { CalendarPanel } from '../lib/lazyParts'
import { useAuth } from '../lib/auth'
import { canSeeApps } from '../lib/apps'
import { OPEN_CALENDAR_EVENT, readPinned, writePinned } from '../lib/dtrCalendar'

const storage = () => { try { return window.localStorage } catch { return null } }

/**
 * Opens the calendar when the toolbox asks for it (OPEN_CALENDAR_EVENT), and keeps it
 * open across chats when it is pinned. Renders nothing until then; the calendar itself
 * is loaded on first use. Mounted once, beside the routes, while signed in. Shown to the
 * same people as the toolbox (src/lib/apps.js), and the Worker checks the role again.
 */
export default function CalendarHost() {
  const { profile } = useAuth()
  const allowed = canSeeApps(profile)
  const [pinned, setPinned] = useState(() => readPinned(storage()))
  const [open, setOpen] = useState(pinned) // a pinned calendar is there when the app opens

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_CALENDAR_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CALENDAR_EVENT, onOpen)
  }, [])

  const togglePin = useCallback(() => {
    setPinned(p => { writePinned(storage(), !p); return !p })
  }, [])

  // Closing is the one way out of a pinned calendar, and it unpins: closing it and
  // finding it back on the next visit would not be what pressing close means.
  const close = useCallback(() => {
    setOpen(false)
    setPinned(false)
    writePinned(storage(), false)
  }, [])

  if (!allowed || !open) return null
  return (
    <LazySlot overlay title="The calendar couldn't be opened" onDismiss={close}>
      <CalendarPanel pinned={pinned} onTogglePin={togglePin} onClose={close} />
    </LazySlot>
  )
}
