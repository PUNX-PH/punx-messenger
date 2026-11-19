// Message text rendering — small custom parser for chat messages.
// Handles:
//   ```code block```      → <pre><code>
//   `inline code`         → <code>
//   **bold**              → <strong>
//   ~~strike~~            → <del>
//   *italic* / _italic_   → <em>
//   https://url           → <a>
//   :emoji:               → <img> (custom emoji)
//   <@uid>                → <span> @Name (user mention)
//   ||spoiler||           → hidden until pressed (see spoilers.js)
//
// Which piece is which is decided in inlineTokens.js (so it can be tested without a screen).
//
// We do NOT pull in a full markdown lib — chat messages are short and we want
// to combine with our custom emoji + mention tokens without a plugin dance.

import { useState } from 'react'
import { tokenizeInline } from './inlineTokens'
import { spoilerInner } from './spoilers'

const CODE_BLOCK_RE = /```([\s\S]*?)```/g

/**
 * Render message text with markdown + emoji + mention tokens.
 * Returns an array of React nodes.
 */
export function renderMessage(text, { emojiByName = {}, usersById = {}, emojiSize = 22 } = {}) {
  // Not just falsy: a document can carry a number or an object here (any member
  // can write one straight to Firestore), and `.slice` on it would throw while
  // rendering and take the channel down for everyone who opens it.
  if (typeof text !== 'string' || !text) return null

  const out = []
  let lastIdx = 0
  let m
  let k = 0

  CODE_BLOCK_RE.lastIndex = 0
  while ((m = CODE_BLOCK_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(...renderInline(text.slice(lastIdx, m.index), { emojiByName, usersById, emojiSize, kStart: k }))
      k = out.length
    }
    out.push(
      <pre
        key={`b-${m.index}`}
        className="bg-bg-deepest border border-line-subtle rounded-md p-2 my-1 overflow-x-auto text-[0.85rem] leading-snug font-mono whitespace-pre"
      >
        <code>{m[1].replace(/^\n/, '').replace(/\n$/, '')}</code>
      </pre>
    )
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) {
    out.push(...renderInline(text.slice(lastIdx), { emojiByName, usersById, emojiSize, kStart: k }))
  }

  return out
}

function renderInline(text, { emojiByName, usersById, emojiSize, kStart = 0 }) {
  const out = []
  let i = kStart
  for (const t of tokenizeInline(text)) {
    if (t.type === 'text') { out.push(t.raw); continue }
    const raw = t.raw
    const key = `${kStart}-${t.index}-${i++}`

    if (t.type === 'code') {
      out.push(<code key={key} className="bg-bg-deepest border border-line-subtle rounded px-1 py-0.5 text-[0.875em] font-mono">{raw.slice(1, -1)}</code>)
    } else if (t.type === 'bold') {
      out.push(<strong key={key} className="font-semibold">{raw.slice(2, -2)}</strong>)
    } else if (t.type === 'strike') {
      out.push(<del key={key} className="opacity-70">{raw.slice(2, -2)}</del>)
    } else if (t.type === 'italic') {
      out.push(<em key={key}>{raw.slice(1, -1)}</em>)
    } else if (t.type === 'url') {
      out.push(
        <a key={key} href={raw} target="_blank" rel="noreferrer" className="text-brand-text hover:underline break-all">
          {raw}
        </a>
      )
    } else if (t.type === 'emoji') {
      const name = raw.slice(1, -1).toLowerCase()
      const e = emojiByName[name]
      out.push(
        e ? (
          <img
            key={key}
            src={e.dataURL}
            alt={`:${e.name}:`}
            title={`:${e.name}:`}
            className="inline-block align-text-bottom"
            style={{ width: emojiSize, height: emojiSize }}
          />
        ) : raw
      )
    } else if (t.type === 'mention') {
      const uid = raw.slice(2, -1)
      const u = usersById[uid]
      out.push(
        <span
          key={key}
          className="inline-flex items-center px-1 rounded bg-brand/15 text-brand-text font-medium cursor-default"
          title={u?.email || ''}
        >
          @{u?.name || 'Unknown'}
        </span>
      )
    } else if (t.type === 'spoiler') {
      // What is inside is drawn like any other text (bold, emoji, mentions...), then hidden.
      out.push(<Spoiler key={key}>{renderInline(spoilerInner(raw), { emojiByName, usersById, emojiSize, kStart: i })}</Spoiler>)
    } else {
      out.push(raw)
    }
  }
  return out
}

/**
 * Hidden text: a bar the colour of the text, until it is pressed (or Enter / Space on it). Pressing
 * shows it for good, as on Discord. While hidden it is not read out and cannot be clicked through
 * (a link inside would otherwise open before the text was shown).
 */
function Spoiler({ children }) {
  const [shown, setShown] = useState(false)
  if (shown) return <span className="rounded px-0.5 bg-bg-hover" data-spoiler="shown">{children}</span>
  const show = () => setShown(true)
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Spoiler, press to show"
      onClick={show}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show() } }}
      className="spoiler-hidden rounded px-0.5 bg-ink-dim select-none cursor-pointer"
      data-spoiler="hidden"
    >
      <span aria-hidden="true" className="pointer-events-none">{children}</span>
    </span>
  )
}

/** True if the message text is only emoji tokens (and whitespace). */
export const isOnlyEmojis = (text) => {
  // typeof, because `(5 || '').trim` is "not a function" and this runs for every
  // message on every render.
  const t = typeof text === 'string' ? text.trim() : ''
  return !!t && /^(\s*:[a-z0-9_]{2,32}:\s*)+$/i.test(t)
}

/** Does this message text mention the given uid? */
export const mentionsUid = (text, uid) =>
  !!uid && typeof text === 'string' && text.includes(`<@${uid}>`)

/** Extract all mentioned uids from message text. */
export function extractMentionedUids(text) {
  if (!text) return []
  const s = new Set()
  const re = /<@([A-Za-z0-9_-]{6,40})>/g
  let m
  while ((m = re.exec(text)) !== null) s.add(m[1])
  return [...s]
}

/**
 * Convert visible @Name mentions in composer text to their <@uid> tokens.
 * `hintMap` is a Map of exact chunks ("@Alice") → uid, populated when the
 * user picks from autocomplete. Applied first so intentional picks always
 * win. Then any remaining "@Name" is matched against workspace users by
 * exact display name (longest first, to disambiguate name-inside-name cases).
 */
export function resolveMentions(text, users = [], hintMap) {
  if (!text) return text
  let out = text
  if (hintMap && hintMap.size) {
    for (const [chunk, uid] of hintMap.entries()) {
      if (chunk) out = out.split(chunk).join(`<@${uid}>`)
    }
  }
  const sorted = users
    .filter(u => u.name)
    .slice()
    .sort((a, b) => (b.name.length || 0) - (a.name.length || 0))
  for (const u of sorted) {
    const escaped = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![\\w<])@${escaped}(?!\\w)`, 'g')
    out = out.replace(re, `<@${u.id}>`)
  }
  return out
}
