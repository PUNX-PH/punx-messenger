import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth, isAdmin } from '../lib/auth'
import { listenGroup } from '../lib/groups'
import ChatSurface from '../components/ChatSurface'
import MembersPanel, { MembersToggle } from '../components/MembersPanel'

export default function Channel() {
  const { groupId, channelId } = useParams()
  const { profile } = useAuth()
  const [channel, setChannel] = useState(null)
  const [group, setGroup] = useState(null)
  const [membersOpen, setMembersOpen] = useState(() => {
    try { return localStorage.getItem('punx.membersPanel') !== '0' } catch { return true }
  })

  useEffect(() => {
    try { localStorage.setItem('punx.membersPanel', membersOpen ? '1' : '0') } catch {}
  }, [membersOpen])

  useEffect(() => {
    setChannel(null)
    if (!groupId || !channelId) return
    let cancelled = false
    ;(async () => {
      const snap = await getDoc(doc(db, 'groups', groupId, 'channels', channelId))
      if (!cancelled) setChannel(snap.exists() ? { id: snap.id, ...snap.data() } : { notFound: true })
    })()
    return () => { cancelled = true }
  }, [groupId, channelId])

  useEffect(() => {
    if (!groupId) return
    return listenGroup(groupId, setGroup)
  }, [groupId])

  if (!channel) return <Center>Loading channel…</Center>
  if (channel.notFound) return <Center>Channel not found.</Center>

  const elevated = isAdmin(profile) || group?.adminUids?.includes(profile?.id)
  const path = `groups/${groupId}/channels/${channelId}/messages`

  return (
    <div className="flex-1 flex min-w-0">
      <ChatSurface
        title={channel.name}
        icon="#"
        path={path}
        canPin={elevated}
        canDeleteAny={elevated}
        composerPlaceholder={`Message #${channel.name}`}
        empty={{
          title: `Welcome to #${channel.name}`,
          desc: 'This is the start of the channel. Drop a message to get the conversation going.',
        }}
        headerExtras={
          <MembersToggle open={membersOpen} onToggle={() => setMembersOpen(o => !o)} />
        }
      />
      <MembersPanel group={group} open={membersOpen} />
    </div>
  )
}

function Center({ children }) {
  return (
    <main className="flex-1 grid place-items-center bg-bg-main text-ink-muted text-sm">
      {children}
    </main>
  )
}
