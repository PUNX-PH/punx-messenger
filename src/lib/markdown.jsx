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
//
// We do NOT pull in a full markdown lib — chat messages are short and we want
// to combine with our custom emoji + mention tokens without a plugin dance.

const INLINE_RE = new RegExp(
  [
    '(`[^`\\n]+?`)',                  // 1 inline code
    '(\\*\\*[^*\\n]+?\\*\\*)',        // 2 bold
    '(~~[^~\\n]+?~~)',                // 3 strike
    '(\\*[^*\\n]+?\\*)',              // 4 italic *
    '(_[^_\\n]+?_)',                  // 5 italic _
    '(https?://[^\\s<>]+)',           // 6 url
    '(:[a-z0-9_]{2,32}:)',            // 7 emoji
    '(<@[A-Za-z0-9_-]{6,40}>)',       // 8 mention
  ].join('|'),
  'gi'
)

const CODE_BLOCK_RE = /```([\s\S]*?)```/g

/**
 * Render message text with markdown + emoji + mention tokens.
 * Returns an array of React nodes.
 */
export function renderMessage(text, { emojiByName = {}, usersById = {}, emojiSize = 22 } = {}) {
  if (!text) return null

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
  let lastIdx = 0
  let i = kStart
  INLINE_RE.lastIndex = 0
  let m
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(text.slice(lastIdx, m.index))
    }
    const [match, code, bold, strike, italic1, italic2, url, emoji, mention] = m
    const key = `${kStart}-${m.index}-${i++}`

    if (code) {
      out.push(<code key={key} className="bg-bg-deepest border border-line-subtle rounded px-1 py-0.5 text-[0.875em] font-mono">{code.slice(1, -1)}</code>)
    } else if (bold) {
      out.push(<strong key={key} className="font-semibold">{bold.slice(2, -2)}</strong>)
    } else if (strike) {
      out.push(<del key={key} className="opacity-70">{strike.slice(2, -2)}</del>)
    } else if (italic1) {
      out.push(<em key={key}>{italic1.slice(1, -1)}</em>)
    } else if (italic2) {
      out.push(<em key={key}>{italic2.slice(1, -1)}</em>)
    } else if (url) {
      out.push(
        <a key={key} href={url} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all">
          {url}
        </a>
      )
    } else if (emoji) {
      const name = emoji.slice(1, -1).toLowerCase()
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
        ) : match
      )
    } else if (mention) {
      const uid = mention.slice(2, -1)
      const u = usersById[uid]
      out.push(
        <span
          key={key}
          className="inline-flex items-center px-1 rounded bg-brand/15 text-brand font-medium cursor-default"
          title={u?.email || ''}
        >
          @{u?.name || 'Unknown'}
        </span>
      )
    } else {
      out.push(match)
    }
    lastIdx = m.index + match.length
  }
  if (lastIdx < text.length) {
    out.push(text.slice(lastIdx))
  }
  return out
}

/** True if the message text is only emoji tokens (and whitespace). */
export const isOnlyEmojis = (text) => {
  const t = (text || '').trim()
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
