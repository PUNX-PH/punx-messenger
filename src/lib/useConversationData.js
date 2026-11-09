// The conversations this person can go to: their DMs, their groups, and each group's
// channels. One place for the listeners that the tab-title counter and the quick
// switcher both need (and that the side rail and DM list each have their own copy
// of). Identical Firestore queries are shared by the client, so another hook asking
// for the same thing adds no reads.
import { useEffect, useState } from 'react'
import { useAuth, channelViewer } from './auth'
import { listenMyDmConvos } from './db'
import { listenChannels, listenMyGroups } from './groups'

export function useConversationData() {
  const { profile } = useAuth()
  const meId = profile?.id

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

  return { convosByOther, groups, channelsByGroup }
}
