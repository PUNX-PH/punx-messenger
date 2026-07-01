import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth'
import { PRESETS, resizeToDataURL } from './images'

// Workspace-wide custom emojis. Stored at /emojis/{id}.
// Name pattern: 2–32 chars, lowercase letters, digits, underscore.

const NAME_RE = /^[a-z0-9_]{2,32}$/

export function listenEmojis(cb) {
  const q = query(collection(db, 'emojis'), orderBy('name'))
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
}

export async function createEmoji({ name, file, createdBy }) {
  const n = name.trim().toLowerCase()
  if (!NAME_RE.test(n)) {
    throw new Error('Use 2–32 chars: lowercase letters, numbers, underscore.')
  }
  // Uniqueness check
  const existing = await getDocs(collection(db, 'emojis'))
  if (existing.docs.some(d => d.data().name === n)) {
    throw new Error(`":${n}:" already exists.`)
  }
  const out = await resizeToDataURL(file, PRESETS.EMOJI)
  await addDoc(collection(db, 'emojis'), {
    name: n,
    dataURL: out.dataURL,
    createdBy,
    createdAt: serverTimestamp(),
  })
}

export async function deleteEmoji(emojiId) {
  await deleteDoc(doc(db, 'emojis', emojiId))
}

// Render text with :name: tokens replaced by inline emoji <img>s.
// Returns an array of strings / React elements.
export function renderEmojiText(text, emojiByName, { size = 22 } = {}) {
  if (!text) return null
  const parts = text.split(/(:[a-z0-9_]{2,32}:)/gi)
  return parts.map((part, i) => {
    const m = part.match(/^:([a-z0-9_]{2,32}):$/i)
    if (m) {
      const e = emojiByName[m[1].toLowerCase()]
      if (e) {
        return (
          <img
            key={i}
            src={e.dataURL}
            alt={`:${e.name}:`}
            title={`:${e.name}:`}
            className="inline-block align-text-bottom"
            style={{ width: size, height: size }}
          />
        )
      }
    }
    return part
  })
}

// ---------- Shared emojis context ----------
const EmojisCtx = createContext({ emojis: [], byName: {} })

export function EmojisProvider({ children }) {
  const { profile } = useAuth()
  const [emojis, setEmojis] = useState([])

  useEffect(() => {
    if (!profile) return
    return listenEmojis(setEmojis)
  }, [profile])

  const byName = useMemo(() => {
    const m = {}
    for (const e of emojis) m[e.name] = e
    return m
  }, [emojis])

  return <EmojisCtx.Provider value={{ emojis, byName }}>{children}</EmojisCtx.Provider>
}

export const useEmojis = () => useContext(EmojisCtx)
