// "Mark everything as read": how much is unread, and the one call that clears it. Uses the
// same data the tab title and the quick switcher use (useConversationData), so identical
// queries are shared and this adds no reads. Only the person's own groups: a group they are
// only overseeing has no unread state to clear.
import { useCallback, useMemo } from 'react'
import { useAuth } from './auth'
import { markManyRead } from './db'
import { unreadKeys } from './unread'
import { useConversationData } from './useConversationData'
import { useUsers } from './users'

export function useMarkAllRead() {
  const { profile } = useAuth()
  const { byId } = useUsers()
  const { convosByOther, channelsByGroup } = useConversationData()
  const uid = profile?.id
  const lastRead = byId[uid]?.lastRead

  const keys = useMemo(() => {
    const { dms, channels } = unreadKeys({ dmConvos: Object.values(convosByOther || {}), channelsByGroup, lastRead: lastRead || {} })
    return [...dms, ...channels]
  }, [convosByOther, channelsByGroup, lastRead])

  const markAll = useCallback(async () => {
    try { await markManyRead(uid, keys) } catch (e) { console.warn('[unread] could not mark everything as read:', e) }
  }, [uid, keys])

  return { count: keys.length, markAll }
}
