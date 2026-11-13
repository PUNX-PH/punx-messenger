// The "jump to a conversation" list: what can be jumped to, and how a typed query
// ranks it. Pure, so the ranking (the part people feel) is tested.

import { isUnread, pathToReadKey } from './unread.js'

/** Lower-case, accents removed: "Zoë" is found by "zoe". */
export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Sent on window to open the switcher from somewhere other than the keyboard (the menu). */
export const OPEN_EVENT = 'punx:quick-switcher'

const ms = (ts) => ts?.toMillis?.() ?? 0

/**
 * Everything the person can open: their notes, each teammate, each channel.
 * @returns {Array<{id, kind: 'notes'|'dm'|'channel'|'voice', label, hint, path, unread, at, user?}>}
 */
export function buildTargets({
  meUid, users = [], convosByOther = {}, groups = [], channelsByGroup = {}, lastRead = {}, mutedGroups = new Set(), mutedChats = new Set(),
}) {
  const out = [{ id: 'notes', kind: 'notes', label: 'My Notes', hint: 'Private to you', path: '/me/notes', unread: false, at: 0 }]

  for (const u of users) {
    if (!u || u.id === meUid) continue
    const convo = convosByOther[u.id]
    const dmKey = convo ? pathToReadKey(`dms/${convo.id}`) : null
    const unread = !!convo && !!convo.lastMessageAuthorUid && convo.lastMessageAuthorUid !== meUid
      && !mutedChats.has(dmKey)
      && isUnread(convo.lastMessageAt, lastRead[dmKey])
    out.push({
      id: `dm:${u.id}`, kind: 'dm', label: u.name || u.email || 'Unknown', hint: u.email || '',
      path: `/dms/${u.id}`, unread, at: ms(convo?.lastMessageAt), user: u,
    })
  }

  for (const g of groups) {
    for (const c of channelsByGroup[g.id] || []) {
      const chKey = pathToReadKey(`groups/${g.id}/channels/${c.id}`)
      const unread = !mutedGroups.has(g.id)
        && !mutedChats.has(chKey)
        && isUnread(c.lastMessageAt, lastRead[chKey])
      out.push({
        id: `ch:${g.id}:${c.id}`, kind: c.type === 'voice' ? 'voice' : 'channel', label: c.name || 'channel', hint: g.name || '',
        path: `/g/${g.id}/c/${c.id}`, unread, at: ms(c.lastMessageAt),
      })
    }
  }
  return out
}

// One word of the query against one target: how well, or 0 for not at all.
function scoreToken(token, label, hint) {
  const words = label.split(/[\s\-_./]+/).filter(Boolean)
  if (label.startsWith(token)) return 100
  if (words.some(w => w.startsWith(token))) return 80
  if (label.includes(token)) return 60
  if (hint.includes(token)) return 40
  // Letters in order, starting at the beginning of a word: "mkt" finds "marketing".
  // (Starting anywhere let "ana" find "brand-assets" by picking letters out of it.)
  const startsAt = (from) => {
    let i = 0
    for (let k = from; k < label.length && i < token.length; k++) if (label[k] === token[i]) i++
    return i === token.length
  }
  for (let k = 0; k < label.length; k++) {
    const atWordStart = k === 0 || /[\s\-_./]/.test(label[k - 1])
    if (atWordStart && label[k] === token[0] && startsAt(k)) return 20
  }
  return 0
}

/** Newest activity first; the name breaks a tie. */
const byRecency = (a, b) => (b.at - a.at) || a.label.localeCompare(b.label)

/**
 * The targets for a query, best first.
 *
 * Every word must match (name, or the group a channel is in, or the letters in
 * order). Names that start with the word beat words inside them, which beat the
 * middle of a word. Unread conversations rise. A leading "#" means channels only
 * and "@" means people only. With nothing typed: what is unread, then what was
 * active most recently.
 */
export function rankTargets(targets, query = '', limit = 12) {
  let q = normalize(query).trim()
  let only = null
  if (q.startsWith('#')) { only = ['channel', 'voice']; q = q.slice(1).trim() }
  else if (q.startsWith('@')) { only = ['dm']; q = q.slice(1).trim() }
  const pool = only ? targets.filter(t => only.includes(t.kind)) : targets

  if (!q) {
    return pool.slice().sort((a, b) => (Number(b.unread) - Number(a.unread)) || byRecency(a, b)).slice(0, limit)
  }

  const tokens = q.split(/\s+/)
  const scored = []
  for (const t of pool) {
    const label = normalize(t.label), hint = normalize(t.hint)
    let total = 0
    for (const token of tokens) {
      const s = scoreToken(token, label, hint)
      if (!s) { total = 0; break }
      total += s
    }
    if (total) scored.push({ t, score: total + (t.unread ? 15 : 0) })
  }
  scored.sort((a, b) => (b.score - a.score) || byRecency(a.t, b.t))
  return scored.slice(0, limit).map(x => x.t)
}

/**
 * Where "next unread" goes. Down is the conversation that has been waiting longest,
 * Up the newest one. The conversation on screen is never the answer (it is being
 * read), so pressing the key again moves on, and nothing is returned when there
 * is nothing to go to. Voice rooms and notes are never unread, so never chosen.
 */
export function pickUnread(targets, currentPath, direction) {
  const waiting = targets
    .filter(t => t.unread && t.path !== currentPath)
    .sort((a, b) => (a.at - b.at) || a.label.localeCompare(b.label))
  if (waiting.length === 0) return null
  return direction === 'up' ? waiting[waiting.length - 1] : waiting[0]
}

/**
 * Does this key press ask for the next/previous unread conversation? Alt+Shift with
 * the Up or Down arrow (what Discord uses), and nothing else held. 'up' | 'down' | null.
 */
export function unreadKeyDirection(e) {
  if (!e || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null
  if (e.isComposing) return null
  if (e.key === 'ArrowUp') return 'up'
  if (e.key === 'ArrowDown') return 'down'
  return null
}
