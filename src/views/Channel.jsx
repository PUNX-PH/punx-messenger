import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth, isAdmin } from '../lib/auth'
import { listenChannels, listenGroup } from '../lib/groups'
import ChatSurface from '../components/ChatSurface'
import MembersPanel, { MembersToggle } from '../components/MembersPanel'
import VoiceChannelRoom from './VoiceChannelRoom'

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
    return listenChannels(groupId, (channels) => {
      setChannel(channels.find(c => c.id === channelId) || { notFound: true })
    })
  }, [groupId, channelId])

  useEffect(() => {
    if (!groupId) return
    return listenGroup(groupId, setGroup)
  }, [groupId])

  if (!channel) return <Center>Loading channel…</Center>
  if (channel.notFound) return <Center>Channel not found.</Center>

  if (channel.type === 'voice') return <VoiceChannelRoom channel={channel} groupId={groupId} />

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
