import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, isAdmin } from '../lib/auth'
import { useUsers } from '../lib/users'
import {
  addMember, removeMember, setGroupAdmin,
  updateGroup, updateGroupAvatar, updateGroupBanner,
} from '../lib/groups'
import Modal from './Modal'
import Avatar from './Avatar'

export default function GroupSettingsModal({ open, onClose, group }) {
  const { profile } = useAuth()
  const { users } = useUsers()
  const [tab, setTab] = useState('overview')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [savedTick, setSavedTick] = useState(0)
  const avatarInputRef = useRef(null)
  const bannerInputRef = useRef(null)

  useEffect(() => { setName(group?.name || '') }, [group?.id, group?.name])
  useEffect(() => { if (open) { setTab('overview'); setError(null) } }, [open, group?.id])

  if (!group) return null

  const isOwner = group.ownerUid === profile?.id
  const isWsAdmin = isAdmin(profile)
  const isGroupAdmin = group.adminUids?.includes(profile?.id)
  const canEdit = isWsAdmin || isGroupAdmin || isOwner
  const canManageRoles = isWsAdmin || isOwner

  const tick = () => { setSavedTick(t => t + 1); setTimeout(() => setSavedTick(0), 1200) }
  const wrap = async (fn) => {
    setBusy(true); setError(null)
    try { await fn(); tick() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} maxWidth="max-w-xl">
      <div className="relative">
        <div className="relative h-32 bg-bg-deepest overflow-hidden rounded-t-lg">
          {group.bannerURL && (
            <img src={group.bannerURL} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
          {canEdit && (
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                onClick={() => bannerInputRef.current?.click()}
                className="text-xs bg-black/60 hover:bg-black/80 text-white px-2.5 py-1 rounded-md backdrop-blur"
              >
                {group.bannerURL ? 'Change banner' : 'Upload banner'}
              </button>
              {group.bannerURL && (
                <button
                  onClick={() => wrap(() => updateGroupBanner(group.id, null))}
                  className="text-xs bg-black/60 hover:bg-bad text-white px-2.5 py-1 rounded-md backdrop-blur"
                >
                  Remove
                </button>
              )}
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) wrap(() => updateGroupBanner(group.id, f))
                }}
              />
            </div>
          )}
        </div>

        <div className="absolute left-6 -bottom-8">
          <button
            disabled={!canEdit}
            onClick={() => avatarInputRef.current?.click()}
            className="w-20 h-20 rounded-full overflow-hidden border-4 border-bg-raised bg-brand grid place-items-center text-white text-2xl font-bold relative group disabled:cursor-default"
            title={canEdit ? 'Change avatar' : ''}
          >
            {group.imageURL
              ? <img src={group.imageURL} alt="" className="w-full h-full object-cover" />
              : <span>{group.name?.[0]?.toUpperCase() || '?'}</span>}
            {canEdit && (
              <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 grid place-items-center text-xs font-medium transition-opacity">
                Change
              </span>
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) wrap(() => updateGroupAvatar(group.id, f))
            }}
          />
        </div>
      </div>

      <div className="pt-12 px-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-line-subtle mb-4">
          <Tab active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Tab>
          <Tab active={tab === 'members'} onClick={() => setTab('members')}>
            Members <span className="text-ink-dim">({group.memberUids?.length || 0})</span>
          </Tab>
        </div>

        {tab === 'overview' && (
          <OverviewTab
            name={name} setName={setName}
            group={group}
            canEdit={canEdit}
            busy={busy}
            onSave={() => {
              const v = name.trim()
              if (!v || v === group.name) return
              wrap(() => updateGroup(group.id, { name: v }))
            }}
          />
        )}

        {tab === 'members' && (
          <MembersTab
            group={group}
            allUsers={users}
            meUid={profile?.id}
            canManage={canEdit}
            canManageRoles={canManageRoles}
            busy={busy}
            onAdd={(uid) => wrap(() => addMember(group.id, uid))}
            onRemove={(uid) => wrap(() => removeMember(group.id, uid))}
            onSetGroupAdmin={(uid, on) => wrap(() => setGroupAdmin(group.id, uid, on))}
          />
        )}

        {error && (
          <div className="mt-4 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {savedTick > 0 && <div className="mt-3 text-xs text-ok">Saved.</div>}

        <div className="flex justify-end mt-6 pb-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-muted hover:underline text-sm disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
        active
          ? 'border-brand text-ink'
          : 'border-transparent text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function OverviewTab({ name, setName, group, canEdit, busy, onSave }) {
  return (
    <>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
        Group Name
      </label>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={!canEdit || busy}
          maxLength={50}
          className="flex-1 bg-bg-deepest border border-line-subtle rounded-md px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
        />
        {canEdit && (
          <button
            onClick={onSave}
            disabled={busy || !name.trim() || name === group.name}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 rounded-md transition-colors"
          >
            Save
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="mt-4 text-xs text-ink-dim">
          You're a member of this group but can't edit its settings.
        </div>
      )}
    </>
  )
}

function MembersTab({
  group, allUsers, meUid,
  canManage, canManageRoles, busy,
  onAdd, onRemove, onSetGroupAdmin,
}) {
  const [filter, setFilter] = useState('')
  const [addPickerOpen, setAddPickerOpen] = useState(false)

  const memberIds = group.memberUids || []
  const memberIdsSet = new Set(memberIds)
  const adminIdsSet = new Set(group.adminUids || [])

  const members = useMemo(() => {
    return allUsers
      .filter(u => memberIdsSet.has(u.id))
      .sort((a, b) => {
        // Owner first, then group admins, then by name
        const oA = group.ownerUid === a.id ? 0 : adminIdsSet.has(a.id) ? 1 : 2
        const oB = group.ownerUid === b.id ? 0 : adminIdsSet.has(b.id) ? 1 : 2
        if (oA !== oB) return oA - oB
        return (a.name || '').localeCompare(b.name || '')
      })
  }, [allUsers, memberIds, group.ownerUid, group.adminUids])

  const filteredMembers = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return members
    return members.filter(u =>
      u.name?.toLowerCase().includes(f) || u.email?.toLowerCase().includes(f)
    )
  }, [members, filter])

  const candidates = useMemo(() => {
    return allUsers
      .filter(u => !memberIdsSet.has(u.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [allUsers, memberIds])

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter members"
          className="flex-1 bg-bg-deepest border border-line-subtle rounded-md px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        {canManage && (
          <button
            onClick={() => setAddPickerOpen(o => !o)}
            className="bg-brand hover:bg-brand-hover text-white text-sm font-medium px-3 py-1.5 rounded-md whitespace-nowrap"
          >
            + Add member
          </button>
        )}
      </div>

      {addPickerOpen && (
        <AddPicker
          candidates={candidates}
          onPick={(uid) => { onAdd(uid); setAddPickerOpen(false) }}
          onClose={() => setAddPickerOpen(false)}
        />
      )}

      <div className="bg-bg-deepest border border-line-subtle rounded-lg overflow-hidden max-h-80 overflow-y-auto scrollbar-thin">
        {filteredMembers.map(u => {
          const isOwner = group.ownerUid === u.id
          const isGroupAdmin = adminIdsSet.has(u.id) && !isOwner
          const isMe = u.id === meUid
          const groupRoleLabel = isOwner ? 'Owner' : isGroupAdmin ? 'Group admin' : 'Member'

          return (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2 border-b border-line-subtle last:border-b-0 hover:bg-bg-hover/50">
              <Avatar name={u.name} src={u.photoURL} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  <span className="truncate">{u.name}</span>
                  {isMe && <span className="text-[10px] text-ink-dim">(you)</span>}
                </div>
                <div className="text-xs text-ink-dim truncate">{u.email}</div>
              </div>

              <span className={[
                'text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border',
                isOwner ? 'text-warn border-warn/40 bg-warn/10'
                  : isGroupAdmin ? 'text-brand border-brand/40 bg-brand/10'
                  : 'text-ink-dim border-line-subtle',
              ].join(' ')}>
                {groupRoleLabel}
              </span>

              {canManageRoles && !isOwner && (
                <button
                  onClick={() => onSetGroupAdmin(u.id, !isGroupAdmin)}
                  disabled={busy}
                  className="text-xs text-ink-muted hover:text-ink disabled:opacity-50 whitespace-nowrap"
                >
                  {isGroupAdmin ? 'Demote' : 'Make admin'}
                </button>
              )}

              {canManage && !isOwner && !isMe && (
                <button
                  onClick={() => {
                    if (confirm(`Remove ${u.name} from the group?`)) onRemove(u.id)
                  }}
                  disabled={busy}
                  className="text-xs text-ink-dim hover:text-bad disabled:opacity-50"
                  title="Remove from group"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}

        {filteredMembers.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">
            {members.length === 0 ? 'No members.' : 'No match.'}
          </div>
        )}
      </div>

      {!canManage && (
        <div className="mt-3 text-xs text-ink-dim">
          You can see members but can't add or remove anyone.
        </div>
      )}
    </>
  )
}

function AddPicker({ candidates, onPick, onClose }) {
  const [filter, setFilter] = useState('')
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return candidates
    return candidates.filter(u =>
      u.name?.toLowerCase().includes(f) || u.email?.toLowerCase().includes(f)
    )
  }, [candidates, filter])

  return (
    <div className="mb-3 bg-bg-deepest border border-brand/40 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-line-subtle flex items-center gap-2">
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          placeholder="Pick a teammate to add"
          className="flex-1 bg-bg-raised border border-line-subtle rounded-md px-2 py-1 text-sm outline-none focus:border-brand"
        />
        <button onClick={onClose} className="text-xs text-ink-dim hover:text-ink">
          Cancel
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto scrollbar-thin">
        {visible.map(u => (
          <button
            key={u.id}
            onClick={() => onPick(u.id)}
            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-hover text-left transition-colors"
          >
            <Avatar name={u.name} src={u.photoURL} size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{u.name}</div>
              <div className="text-xs text-ink-dim truncate">{u.email}</div>
            </div>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-ink-muted">
            {candidates.length === 0
              ? 'Everyone is already in this group.'
              : 'No match.'}
          </div>
        )}
      </div>
    </div>
  )
}
