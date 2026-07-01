import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth, isAdmin } from '../lib/auth'
import { useUsers } from '../lib/users'
import { createChannel, listenChannels, listenGroup } from '../lib/groups'
import { isUnread, pathToReadKey } from '../lib/db'
import UserPanel from './UserPanel'
import GroupSettingsModal from './GroupSettingsModal'

export default function ChannelSidebar() {
  const { profile } = useAuth()
  const { byId: usersById } = useUsers()
  const { groupId, channelId: activeChannelId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [group, setGroup] = useState(null)
  const [channels, setChannels] = useState([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Auto-open settings if URL has ?settings=1 (used by group context menu)
  useEffect(() => {
    if (searchParams.get('settings') === '1') {
      setSettingsOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('settings')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!groupId) return
    return listenGroup(groupId, setGroup)
  }, [groupId])

  useEffect(() => {
    if (!groupId) return
    return listenChannels(groupId, setChannels)
  }, [groupId])

  const me = usersById[profile?.id]
  const lastRead = me?.lastRead || {}
  const canManage = isAdmin(profile) || group?.adminUids?.includes(profile?.id)

  const submitNewChannel = async (e) => {
    e.preventDefault()
    const v = newName.trim()
    if (!v) return
    const id = await createChannel(groupId, { name: v, createdBy: profile.id })
    setNewName(''); setCreating(false)
    navigate(`/g/${groupId}/c/${id}`)
  }

  return (
    <aside className="w-60 bg-bg-dark flex flex-col border-r border-line-subtle">
      <button
        onClick={() => setSettingsOpen(true)}
        className="text-left shrink-0 hover:bg-bg-hover transition-colors border-b border-line-subtle shadow-elev1 group/header"
      >
        {group?.bannerURL ? (
          <div className="relative h-16 overflow-hidden">
            <img src={group.bannerURL} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/0 to-black/40" />
            <div className="absolute bottom-1.5 left-3 right-3 flex items-center justify-between">
              <span className="text-sm font-semibold tracking-tight text-white drop-shadow truncate">
                {group?.name || '…'}
              </span>
              <ChevronDown className="text-white/80" />
            </div>
          </div>
        ) : (
          <div className="h-12 flex items-center px-4 gap-2">
            <span className="text-sm font-semibold tracking-tight truncate flex-1">
              {group?.name || '…'}
            </span>
            <ChevronDown className="text-ink-dim opacity-0 group-hover/header:opacity-100 transition-opacity" />
          </div>
        )}
      </button>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
        <div className="px-2 pt-1 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-ink-dim">Text channels</span>
          {canManage && (
            <button
              onClick={() => setCreating(v => !v)}
              title="Create channel"
              className="text-ink-dim hover:text-ink"
            >
              <PlusIcon />
            </button>
          )}
        </div>

        {creating && (
          <form onSubmit={submitNewChannel} className="px-2 pb-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={() => !newName.trim() && setCreating(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setCreating(false) }}
              placeholder="new-channel"
              className="w-full bg-bg-deepest text-sm rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-brand"
            />
          </form>
        )}

        {channels.map(c => {
          const key = pathToReadKey(`groups/${groupId}/channels/${c.id}`)
          const active = c.id === activeChannelId
          const unread = !active && isUnread(c.lastMessageAt, lastRead[key])
          return (
            <NavLink
              key={c.id}
              to={`/g/${groupId}/c/${c.id}`}
              className={({ isActive }) => [
                'w-full text-left px-2 py-1.5 rounded-sm text-sm flex items-center gap-2 transition-colors duration-150',
                isActive
                  ? 'bg-bg-hover text-ink'
                  : unread
                    ? 'text-ink font-semibold hover:bg-bg-raised'
                    : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
              ].join(' ')}
            >
              <span className="text-ink-dim">#</span>
              <span className="truncate flex-1">{c.name}</span>
              {unread && <UnreadDot />}
            </NavLink>
          )
        })}

        {channels.length === 0 && (
          <div className="px-2 py-3 text-xs text-ink-dim">No channels yet.</div>
        )}
      </div>

      <UserPanel />

      <GroupSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        group={group}
      />
    </aside>
  )
}

function UnreadDot() {
  return <span className="w-2 h-2 rounded-full bg-bad shrink-0" />
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function ChevronDown({ className = '' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
