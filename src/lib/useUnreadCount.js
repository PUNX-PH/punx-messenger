// How many conversations have something new, for the browser tab.
//
// Listens for the same things the side rail and the DM list do (your DMs, your
// groups, each group's channels). Identical queries are shared by the Firestore
// client, so this adds no reads, only a place to count them. What counts as unread
// is in unread.js, where it is tested.
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth, channelViewer } from './auth'
import { useUsers } from './users'
import { listenMyDmConvos } from './db'
import { listenChannels, listenMyGroups } from './groups'
import { countUnread, readKeyForRoute } from './unread'
import { usePageActive } from './usePageActive'

export function useUnreadCount() {
  const { profile } = useAuth()
  const { byId } = useUsers()
  const { pathname } = useLocation()
  const active = usePageActive()
  const meId = profile?.id
  const meUid = profile?.uid

  const [convosByOther, setConvosByOther] = useState({})
  const [groups, setGroups] = useState([])
  const [channelsByGroup, setChannelsByGroup] = useState({})

  useEffect(() => {
    if (!meId) return
    return listenMyDmConvos(meId, setConvosByOther)
  }, [meId])

  useEffect(() => {
    if (!meId) return
    return listenMyGroups(meId, setGroups)
  }, [meId])

  // Channels of every group I am in. Guests and private channels need the viewer
  // passed, or the query is denied outright (see the same note in ServerRail).
  const groupIds = groups.map(g => g.id).join('|')
  useEffect(() => {
    if (groups.length === 0) { setChannelsByGroup({}); return }
    const unsubs = groups.map(g =>
      listenChannels(
        g.id,
        (chs) => setChannelsByGroup(prev => ({ ...prev, [g.id]: chs })),
        undefined,
        channelViewer(profile, g),
      ),
    )
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIds])

  const me = byId[meId]
  const lastRead = me?.lastRead
  const mutedList = me?.mutedGroups

  return useMemo(() => countUnread({
    dmConvos: Object.values(convosByOther),
    channelsByGroup,
    lastRead: lastRead || {},
    mutedGroups: new Set(mutedList || []),
    meUid,
    // Only a conversation being looked at right now is "being read".
    lookingAt: active ? readKeyForRoute(pathname, meUid) : null,
  }), [convosByOther, channelsByGroup, lastRead, mutedList, meUid, active, pathname])
}
