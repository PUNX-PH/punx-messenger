import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth, isAdmin, isGhost, isSuperAdmin } from '../lib/auth'
import { listenChannels, listenGroup } from '../lib/groups'
import ChatSurface from '../components/ChatSurface'
import MembersPanel, { MembersToggle } from '../components/MembersPanel'
import VoiceChannelRoom from './VoiceChannelRoom'

export default function Channel() {
  const { groupId, channelId } = useParams()
  const { profile } = useAuth()
  const [channel, setChannel] = useState(null)
  // undefined = the group doc is still in flight; null = it doesn't exist.
  // The distinction matters below, where "don't know yet" has to fail closed.
  const [group, setGroup] = useState(undefined)
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
    // Back to "loading" on every route change — otherwise the oversight check
    // below reads the *previous* group's membership for a tick, which is long
    // enough to flash a composer into a group you can't post in.
    setGroup(undefined)
    if (!groupId) return
    return listenGroup(groupId, setGroup)
  }, [groupId])

  if (!channel) return <Center>Loading channel…</Center>
  if (channel.notFound) return <Center>Channel not found.</Center>

  // Super-admin oversight: reading a group you were never added to. Until the
  // group doc lands we can't tell a super admin's own groups from the rest, so
  // assume oversight — a composer that shows up a beat late beats one that
  // shows up and then has the message rejected. See isGhost in lib/auth.
  const ghost = group === undefined ? isSuperAdmin(profile) : isGhost(profile, group)

  if (channel.type === 'voice') {
    return <VoiceChannelRoom channel={channel} groupId={groupId} readOnly={ghost} />
  }

  const elevated = !ghost && (isAdmin(profile) || group?.adminUids?.includes(profile?.id))
  const path = `groups/${groupId}/channels/${channelId}/messages`

  return (
    <div className="flex-1 flex min-w-0">
      <ChatSurface
        title={channel.name}
        icon="#"
        path={path}
        canPin={elevated}
        canDeleteAny={elevated}
        readOnly={ghost}
        readOnlyNotice={
          "You're viewing this group as a super admin. You're not a member, so nobody "
          + "here can see you — and you can't post, react or join voice until you join the group."
        }
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
