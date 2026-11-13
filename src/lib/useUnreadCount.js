// How many conversations have something new, for the browser tab.
//
// What counts as unread is in unread.js, where it is tested; the conversations
// themselves come from useConversationData.
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { useUsers } from './users'
import { useConversationData } from './useConversationData'
import { countUnread, readKeyForRoute } from './unread'
import { usePageActive } from './usePageActive'
import { mutedChatsOf } from './muted'

export function useUnreadCount() {
  const { profile } = useAuth()
  const { byId } = useUsers()
  const { pathname } = useLocation()
  const active = usePageActive()
  const meId = profile?.id
  const meUid = profile?.uid
  const { convosByOther, channelsByGroup } = useConversationData()

  const me = byId[meId]
  const lastRead = me?.lastRead
  const mutedList = me?.mutedGroups
  const mutedChatList = me?.mutedChats

  return useMemo(() => countUnread({
    dmConvos: Object.values(convosByOther),
    channelsByGroup,
    lastRead: lastRead || {},
    mutedGroups: new Set(mutedList || []),
    mutedChats: mutedChatsOf({ mutedChats: mutedChatList }),
    meUid,
    // Only a conversation being looked at right now is "being read".
    lookingAt: active ? readKeyForRoute(pathname, meUid) : null,
  }), [convosByOther, channelsByGroup, lastRead, mutedList, mutedChatList, meUid, active, pathname])
}
