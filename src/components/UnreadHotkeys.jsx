import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { useConversationData } from '../lib/useConversationData'
import { buildTargets, pickUnread, unreadKeyDirection } from '../lib/quickSwitch'

/**
 * Alt+Shift+Down opens the conversation that has been waiting longest for you,
 * Alt+Shift+Up the newest one. Press again for the next. Renders nothing; mounted
 * once while signed in, beside the tab-title counter that needs the same data.
 */
export default function UnreadHotkeys() {
  const { profile } = useAuth()
  const { byId, activeUsers } = useUsers()
  const { convosByOther, groups, channelsByGroup } = useConversationData()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const me = byId[profile?.id]
  const targets = useMemo(() => buildTargets({
    meUid: profile?.id, users: activeUsers, convosByOther, groups, channelsByGroup,
    lastRead: me?.lastRead || {}, mutedGroups: new Set(me?.mutedGroups || []),
  }), [profile?.id, activeUsers, convosByOther, groups, channelsByGroup, me?.lastRead, me?.mutedGroups])

  // The key handler is attached once and reads the latest values from here.
  const latest = useRef({ targets, pathname })
  latest.current = { targets, pathname }

  useEffect(() => {
    const onKey = (e) => {
      const dir = unreadKeyDirection(e)
      if (!dir) return
      const next = pickUnread(latest.current.targets, latest.current.pathname, dir)
      e.preventDefault() // also in a text box: Alt+Shift+arrow means nothing useful there
      if (next) navigate(next.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return null
}
