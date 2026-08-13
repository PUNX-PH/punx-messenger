import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth, isAdmin } from '../lib/auth'
import { useUsers } from '../lib/users'
import {
  createCategory, createChannel, deleteCategory, groupChannelsByCategory,
  listenCategories, listenChannels, listenGroup, renameCategory,
  reorderCategories, reorderChannelsInCategory,
} from '../lib/groups'
import { isUnread, pathToReadKey } from '../lib/db'
import { useVoiceChannel } from '../lib/useVoiceChannel'
import UserPanel from './UserPanel'
import GroupSettingsModal from './GroupSettingsModal'
import GroupContextMenu from './GroupContextMenu'
import VoiceParticipants from './voice/VoiceParticipants'
import VoiceStatusBar from './voice/VoiceStatusBar'

export default function ChannelSidebar() {
  const { profile } = useAuth()
  const { byId: usersById } = useUsers()
  const { groupId, channelId: activeChannelId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [group, setGroup] = useState(null)
  const [channels, setChannels] = useState([])
  const [categories, setCategories] = useState([])
  const [creatingIn, setCreatingIn] = useState(undefined) // undefined = none; null = uncategorized; categoryId = that category
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('text')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState('overview')
  const [addMenu, setAddMenu] = useState({ open: false, x: 0, y: 0 })
  const [catMenu, setCatMenu] = useState({ open: false, x: 0, y: 0, category: null })
  const [collapsed, setCollapsed] = useState(() => readCollapsed(groupId))
  const [activeDrag, setActiveDrag] = useState(null)

  // Auto-open settings if URL has ?settings=1 (used by group context menu)
  useEffect(() => {
    if (searchParams.get('settings') === '1') {
      setSettingsInitialTab('overview')
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

  useEffect(() => {
    if (!groupId) return
    return listenCategories(groupId, setCategories)
  }, [groupId])

  useEffect(() => { setCollapsed(readCollapsed(groupId)) }, [groupId])

  const me = usersById[profile?.id]
  const lastRead = me?.lastRead || {}
  const canManage = isAdmin(profile) || group?.adminUids?.includes(profile?.id)

  const grouped = useMemo(() => groupChannelsByCategory(channels, categories), [channels, categories])

  const toggleCollapsed = (categoryId) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      saveCollapsed(groupId, next)
      return next
    })
  }

  const submitNewChannel = async (e) => {
    e.preventDefault()
    const v = newName.trim()
    if (!v || creatingIn === undefined) return
    const id = await createChannel(groupId, { name: v, createdBy: profile.id, categoryId: creatingIn, type: newType })
    const wasVoice = newType === 'voice'
    setNewName(''); setCreatingIn(undefined); setNewType('text')
    // Voice channels have no text-channel-style route to navigate to — Phase A
    // is join-in-place from the sidebar (see SortableChannelRow below).
    if (!wasVoice) navigate(`/g/${groupId}/c/${id}`)
  }

  const submitNewCategory = async (e) => {
    e.preventDefault()
    const v = newName.trim()
    if (!v) return
    await createCategory(groupId, { name: v, createdBy: profile.id })
    setNewName(''); setCreatingCategory(false)
  }

  const openOverviewSettings = () => { setSettingsInitialTab('overview'); setSettingsOpen(true) }
  const openMembersSettings = () => { setSettingsInitialTab('members'); setSettingsOpen(true) }

  const openAddMenu = (e) => setAddMenu({ open: true, x: e.clientX, y: e.clientY })
  const openCategoryMenu = (e, category) => {
    e.preventDefault()
    setCatMenu({ open: true, x: e.clientX, y: e.clientY, category })
  }

  // ── Drag and drop ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragStart = ({ active }) => setActiveDrag(active.data.current)
  const onDragCancel = () => setActiveDrag(null)

  const onDragEnd = ({ active, over }) => {
    setActiveDrag(null)
    if (!over) return
    const activeData = active.data.current
    const overData = over.data.current
    if (!activeData || active.id === over.id) return

    if (activeData.type === 'category') {
      if (overData?.type !== 'category') return
      const ids = grouped.categories.map(c => c.id)
      const oldIndex = ids.indexOf(activeData.category.id)
      const newIndex = ids.indexOf(overData.category.id)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(grouped.categories, oldIndex, newIndex).map(c => c.id)
      reorderCategories(groupId, reordered).catch(err => console.error('[ChannelSidebar] reorderCategories failed:', err))
      return
    }

    if (activeData.type === 'channel') {
      const channelId = activeData.channel.id
      let targetCategoryId
      if (overData?.type === 'channel') targetCategoryId = overData.channel.categoryId ?? null
      else if (overData?.type === 'category-target') targetCategoryId = overData.categoryId
      else return

      const listFor = (catId) => catId === null
        ? grouped.uncategorized
        : (grouped.categories.find(c => c.id === catId)?.channels || [])

      const targetList = listFor(targetCategoryId).filter(c => c.id !== channelId)
      if (overData?.type === 'channel') {
        const overIndex = targetList.findIndex(c => c.id === overData.channel.id)
        targetList.splice(overIndex === -1 ? targetList.length : overIndex, 0, { id: channelId })
      } else {
        targetList.push({ id: channelId })
      }

      reorderChannelsInCategory(groupId, targetCategoryId, targetList.map(c => c.id))
        .catch(err => console.error('[ChannelSidebar] reorderChannelsInCategory failed:', err))
    }
  }

  return (
    <aside className="w-60 bg-bg-dark flex flex-col border-r border-line-subtle">
      <div className="shrink-0 border-b border-line-subtle shadow-elev1 group/header">
        {group?.bannerURL ? (
          <div className="relative h-16 overflow-hidden">
            <button type="button" onClick={openOverviewSettings} className="absolute inset-0 w-full h-full text-left hover:brightness-95 transition-[filter]">
              <img src={group.bannerURL} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/0 to-black/40" />
            </button>
            <div className="absolute bottom-1.5 left-3 right-3 flex items-center justify-between gap-2">
              <button type="button" onClick={openOverviewSettings} className="text-sm font-semibold tracking-tight text-white drop-shadow truncate text-left">
                {group?.name || '…'}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {canManage && (
                  <button type="button" onClick={openMembersSettings} title="Add members" className="text-white/80 hover:text-white p-1 rounded hover:bg-white/10 transition-colors">
                    <AddMemberIcon />
                  </button>
                )}
                <ChevronDown className="text-white/80" />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-12 flex items-center px-4 gap-1 hover:bg-bg-hover transition-colors">
            <button type="button" onClick={openOverviewSettings} className="flex-1 min-w-0 flex items-center gap-2 text-left h-full">
              <span className="text-sm font-semibold tracking-tight truncate flex-1">
                {group?.name || '…'}
              </span>
              <ChevronDown className="text-ink-dim opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0" />
            </button>
            {canManage && (
              <button type="button" onClick={openMembersSettings} title="Add members" className="text-ink-dim hover:text-ink p-1.5 rounded hover:bg-bg-raised transition-colors shrink-0">
                <AddMemberIcon />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-3">
        {canManage && (
          <div className="px-1 flex justify-end">
            <button onClick={openAddMenu} title="Add channel or category" className="text-ink-dim hover:text-ink">
              <PlusIcon />
            </button>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragCancel={onDragCancel}
          onDragEnd={onDragEnd}
        >
          <ChannelListBody
            categoryId={null}
            channels={grouped.uncategorized}
            activeChannelId={activeChannelId}
            groupId={groupId}
            lastRead={lastRead}
            creating={creatingIn === null}
            newName={newName}
            setNewName={setNewName}
            newType={newType}
            setNewType={setNewType}
            onSubmitNew={submitNewChannel}
            onCancelNew={() => setCreatingIn(undefined)}
          />

          <SortableContext items={grouped.categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {grouped.categories.map(cat => (
              <CategorySection
                key={cat.id}
                category={cat}
                collapsed={collapsed.has(cat.id)}
                onToggleCollapse={() => toggleCollapsed(cat.id)}
                onContextMenu={(e) => canManage && openCategoryMenu(e, cat)}
                canManage={canManage}
                onAddChannel={() => { setCreatingIn(cat.id); setNewName('') }}
              >
                <ChannelListBody
                  categoryId={cat.id}
                  channels={cat.channels}
                  activeChannelId={activeChannelId}
                  groupId={groupId}
                  lastRead={lastRead}
                  creating={creatingIn === cat.id}
                  newName={newName}
                  setNewName={setNewName}
                  newType={newType}
                  setNewType={setNewType}
                  onSubmitNew={submitNewChannel}
                  onCancelNew={() => setCreatingIn(undefined)}
                />
              </CategorySection>
            ))}
          </SortableContext>

          <DragOverlay>
            {activeDrag?.type === 'channel' && (
              <div className="px-2 py-1.5 rounded-sm text-sm bg-bg-raised shadow-elev2 flex items-center gap-2">
                <span className="text-ink-dim">#</span>
                <span className="truncate">{activeDrag.channel.name}</span>
              </div>
            )}
            {activeDrag?.type === 'category' && (
              <div className="px-2 py-1 rounded-sm text-[11px] font-semibold uppercase tracking-wider bg-bg-raised shadow-elev2">
                {activeDrag.category.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {creatingCategory && (
          <form onSubmit={submitNewCategory} className="px-1">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={() => !newName.trim() && setCreatingCategory(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setCreatingCategory(false) }}
              placeholder="New category name"
              className="w-full bg-bg-deepest text-sm rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-brand"
            />
          </form>
        )}

        {channels.length === 0 && categories.length === 0 && (
          <div className="px-2 py-3 text-xs text-ink-dim">No channels yet.</div>
        )}
      </div>

      <VoiceStatusBar />
      <UserPanel />

      <GroupSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        group={group}
        initialTab={settingsInitialTab}
      />

      <GroupContextMenu
        open={addMenu.open}
        x={addMenu.x}
        y={addMenu.y}
        onClose={() => setAddMenu(m => ({ ...m, open: false }))}
        items={[
          { label: 'Create channel', icon: <PlusIcon />, onClick: () => { setCreatingIn(null); setNewName('') } },
          { label: 'Create category', icon: <PlusIcon />, onClick: () => { setCreatingCategory(true); setNewName('') } },
        ]}
      />

      <GroupContextMenu
        open={catMenu.open}
        x={catMenu.x}
        y={catMenu.y}
        onClose={() => setCatMenu(m => ({ ...m, open: false }))}
        items={catMenu.category ? [
          { label: 'Add channel here', icon: <PlusIcon />, onClick: () => { setCreatingIn(catMenu.category.id); setNewName('') } },
          { label: 'Rename category', icon: <ChevronDown />, onClick: () => {
              const name = prompt('Rename category', catMenu.category.name)
              if (name?.trim()) renameCategory(groupId, catMenu.category.id, name)
            } },
          { separator: true },
          { label: 'Delete category', icon: <ChevronDown />, danger: true, onClick: () => {
              if (confirm(`Delete category "${catMenu.category.name}"? Its channels move back to uncategorized.`)) {
                deleteCategory(groupId, catMenu.category.id)
              }
            } },
        ] : []}
      />
    </aside>
  )
}

// ───────── Sub-components ─────────

function CategorySection({ category, collapsed, onToggleCollapse, onContextMenu, canManage, onAddChannel, children }) {
  const sortable = useSortable({ id: category.id, data: { type: 'category', category } })
  const target = useDroppable({ id: `catdrop-header:${category.id}`, data: { type: 'category-target', categoryId: category.id } })

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  }

  return (
    <div ref={sortable.setNodeRef} style={style}>
      <div
        ref={target.setNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        onContextMenu={onContextMenu}
        onClick={onToggleCollapse}
        className={[
          'px-2 pt-1 pb-1 flex items-center justify-between cursor-pointer select-none rounded-sm group/cat',
          target.isOver ? 'bg-bg-raised' : '',
        ].join(' ')}
      >
        <span className="flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase text-ink-dim">
          <ChevronDown className={collapsed ? '-rotate-90 transition-transform' : 'transition-transform'} />
          {category.name}
        </span>
        {canManage && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onAddChannel() }}
            title="Add channel"
            className="text-ink-dim hover:text-ink opacity-0 group-hover/cat:opacity-100 transition-opacity"
          >
            <PlusIcon />
          </button>
        )}
      </div>
      {!collapsed && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

function ChannelListBody({
  categoryId, channels, activeChannelId, groupId, lastRead,
  creating, newName, setNewName, newType, setNewType, onSubmitNew, onCancelNew,
}) {
  const target = useDroppable({ id: `catdrop-body:${categoryId ?? 'none'}`, data: { type: 'category-target', categoryId } })
  return (
    <div ref={target.setNodeRef} className={['space-y-0.5 rounded-sm', target.isOver ? 'bg-bg-raised/50' : ''].join(' ')}>
      <SortableContext items={channels.map(c => c.id)} strategy={verticalListSortingStrategy}>
        {channels.map(c => (
          <div key={c.id}>
            <SortableChannelRow
              channel={c}
              groupId={groupId}
              active={c.id === activeChannelId}
              unread={c.id !== activeChannelId && isUnread(c.lastMessageAt, lastRead[pathToReadKey(`groups/${groupId}/channels/${c.id}`)])}
            />
            {c.type === 'voice' && <VoiceParticipants groupId={groupId} channelId={c.id} />}
          </div>
        ))}
      </SortableContext>

      {creating && (
        <form onSubmit={onSubmitNew} className="px-1 space-y-1">
          <div className="flex gap-1">
            <TypePill active={newType === 'text'} onClick={() => setNewType('text')}>Text</TypePill>
            <TypePill active={newType === 'voice'} onClick={() => setNewType('voice')}>Voice</TypePill>
          </div>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={() => !newName.trim() && onCancelNew()}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancelNew() }}
            placeholder={newType === 'voice' ? 'new-voice-channel' : 'new-channel'}
            className="w-full bg-bg-deepest text-sm rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-brand"
          />
        </form>
      )}
    </div>
  )
}

function TypePill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep focus on the name input
      onClick={onClick}
      className={[
        'text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors',
        active ? 'bg-brand text-white' : 'bg-bg-deepest text-ink-dim hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function SortableChannelRow({ channel, groupId, active, unread }) {
  const sortable = useSortable({ id: channel.id, data: { type: 'channel', channel } })
  const { activeChannel, join } = useVoiceChannel()
  const navigate = useNavigate()
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  }

  if (channel.type === 'voice') {
    const connected = activeChannel?.groupId === groupId && activeChannel?.channelId === channel.id
    return (
      <button
        type="button"
        ref={sortable.setNodeRef}
        style={style}
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={() => {
          // join() no-ops if already connected here; navigating is what
          // actually shows the tile grid (VoiceChannelRoom), matching
          // Discord — clicking a voice channel takes you to its own view,
          // it doesn't just connect silently in the background.
          join(groupId, channel.id, channel.name)
          navigate(`/g/${groupId}/c/${channel.id}`)
        }}
        className={[
          'w-full text-left px-2 py-1.5 rounded-sm text-sm flex items-center gap-2 transition-colors duration-150',
          connected ? 'bg-bg-hover text-ink' : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
        ].join(' ')}
      >
        <SpeakerIcon className="text-ink-dim shrink-0" />
        <span className="truncate flex-1">{channel.name}</span>
      </button>
    )
  }

  return (
    <NavLink
      ref={sortable.setNodeRef}
      style={style}
      {...sortable.attributes}
      {...sortable.listeners}
      to={`/g/${groupId}/c/${channel.id}`}
      className={[
        'w-full text-left px-2 py-1.5 rounded-sm text-sm flex items-center gap-2 transition-colors duration-150',
        active
          ? 'bg-bg-hover text-ink'
          : unread
            ? 'text-ink font-semibold hover:bg-bg-raised'
            : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
      ].join(' ')}
    >
      <span className="text-ink-dim">#</span>
      <span className="truncate flex-1">{channel.name}</span>
      {unread && <UnreadDot />}
    </NavLink>
  )
}

// ───────── Collapsed-category persistence (localStorage, per group) ─────────

function collapsedKey(groupId) { return `punx.collapsedCategories.${groupId}` }

function readCollapsed(groupId) {
  if (!groupId) return new Set()
  try { return new Set(JSON.parse(localStorage.getItem(collapsedKey(groupId)) || '[]')) }
  catch { return new Set() }
}

function saveCollapsed(groupId, set) {
  if (!groupId) return
  try { localStorage.setItem(collapsedKey(groupId), JSON.stringify([...set])) }
  catch { /* non-fatal */ }
}

// ───────── Icons ─────────

function UnreadDot() {
  return <span className="w-2 h-2 rounded-full bg-bad shrink-0" />
}
function SpeakerIcon({ className = '' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
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
function AddMemberIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  )
}
