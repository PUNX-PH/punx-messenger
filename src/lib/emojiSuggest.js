// ":emoji:" suggestions in the message box: type a colon and two letters (":fi") and a list of
// matching emoji appears; pick one and it replaces what was typed. Pure, so it is tested.
//
// Two kinds are offered: the workspace's own custom emojis (inserted as their ":name:" token,
// which messages already turn into the picture) and a short list of everyday ones (inserted as
// the character itself). Nothing here touches the network.

const E = (...codePoints) => String.fromCodePoint(...codePoints)
const VS16 = 0xFE0F // asks for the picture form of a symbol that could also be plain text

// [names, the emoji]. The first name is the usual one; the others are what people type.
// Kept to single characters (and a few with VS16) so nothing invisible sits in this file.
const RAW = [
  [['smile'], '😄'], [['smiley'], '😃'], [['grin'], '😁'], [['joy', 'lol'], '😂'], [['rofl'], '🤣'],
  [['slight_smile'], '🙂'], [['wink'], '😉'], [['blush'], '😊'], [['heart_eyes'], '😍'],
  [['kissing_heart'], '😘'], [['sunglasses', 'cool'], '😎'], [['thinking', 'hmm'], '🤔'],
  [['neutral_face'], '😐'], [['unamused'], '😒'], [['roll_eyes'], '🙄'], [['grimacing'], '😬'],
  [['relieved'], '😌'], [['pensive'], '😔'], [['sleepy'], '😪'], [['sob'], '😭'], [['cry'], '😢'],
  [['scream'], '😱'], [['angry'], '😠'], [['rage'], '😡'], [['flushed'], '😳'], [['hushed'], '😯'],
  [['open_mouth'], '😮'], [['astonished'], '😲'], [['confused'], '😕'], [['worried'], '😟'],
  [['disappointed'], '😞'], [['sweat_smile'], '😅'], [['sweat'], '😓'], [['tired_face'], '😫'],
  [['yum'], '😋'], [['stuck_out_tongue'], '😛'], [['zany_face'], '🤪'], [['nerd_face'], '🤓'],
  [['hugs'], '🤗'], [['partying_face'], '🥳'], [['pleading_face'], '🥺'], [['exploding_head'], '🤯'],
  [['sleeping'], '😴'], [['mask'], '😷'], [['face_palm', 'facepalm'], '🤦'], [['shrug'], '🤷'],
  [['+1', 'thumbsup', 'thumbs_up'], '👍'], [['-1', 'thumbsdown', 'thumbs_down'], '👎'],
  [['clap'], '👏'], [['raised_hands'], '🙌'], [['pray', 'thanks', 'please'], '🙏'],
  [['ok_hand'], '👌'], [['wave', 'hi'], '👋'], [['muscle'], '💪'], [['point_up'], '👆'],
  [['point_down'], '👇'], [['point_left'], '👈'], [['point_right'], '👉'],
  [['crossed_fingers'], '🤞'], [['handshake'], '🤝'], [['fist'], '👊'], [['eyes', 'look'], '👀'],
  [['brain'], '🧠'], [['heart'], E(0x2764, VS16)], [['blue_heart'], '💙'], [['green_heart'], '💚'],
  [['yellow_heart'], '💛'], [['purple_heart'], '💜'], [['broken_heart'], '💔'],
  [['sparkling_heart'], '💖'], [['fire', 'lit'], '🔥'], [['100', 'hundred'], '💯'],
  [['tada', 'party'], '🎉'], [['confetti_ball'], '🎊'], [['sparkles'], '✨'], [['star'], '⭐'],
  [['star2'], '🌟'], [['boom'], '💥'], [['zap'], '⚡'], [['rocket', 'ship'], '🚀'],
  [['trophy'], '🏆'], [['medal'], '🏅'], [['gift'], '🎁'], [['birthday'], '🎂'], [['balloon'], '🎈'],
  [['bulb', 'idea'], '💡'], [['memo', 'note'], '📝'], [['calendar'], '📅'], [['pushpin'], '📌'],
  [['paperclip'], '📎'], [['link'], '🔗'], [['lock'], '🔒'], [['key'], '🔑'], [['mag', 'search'], '🔍'],
  [['bell'], '🔔'], [['mega'], '📣'], [['hourglass'], '⌛'], [['alarm_clock'], '⏰'],
  [['white_check_mark', 'check', 'done'], '✅'], [['cross', 'cross_mark'], '❌'],
  [['warning'], E(0x26A0, VS16)], [['question'], '❓'], [['exclamation'], '❗'],
  [['heavy_check_mark'], E(0x2714, VS16)], [['no_entry'], '🚫'], [['construction'], '🚧'],
  [['bug'], '🐛'], [['computer'], '💻'], [['phone'], '📱'], [['email'], '📧'], [['coffee'], '☕'],
  [['pizza'], '🍕'], [['beer'], '🍺'], [['beers'], '🍻'], [['cake'], '🍰'], [['sunny'], E(0x2600, VS16)],
  [['cloud'], E(0x2601, VS16)], [['rainbow'], '🌈'], [['snowflake'], E(0x2744, VS16)],
  [['umbrella'], '☔'], [['moneybag'], '💰'], [['chart_with_upwards_trend', 'chart'], '📈'],
  [['dart', 'target'], '🎯'], [['crown'], '👑'], [['ghost'], '👻'], [['skull'], '💀'], [['poop'], '💩'],
  [['robot'], '🤖'], [['dog'], '🐶'], [['cat'], '🐱'], [['unicorn'], '🦄'],
  [['see_no_evil'], '🙈'], [['hear_no_evil'], '🙉'], [['speak_no_evil'], '🙊'],
]

/** The everyday emoji offered: { name (the usual one), names (all of them), char }. */
export const UNICODE_EMOJIS = RAW.map(([names, char]) => ({ name: names[0], names, char }))

/** Fewest letters after the colon before anything is offered: ":o" or ":3" alone is far more often a smiley or a time. */
export const MIN_QUERY = 2

/** How many suggestions to show at most. */
export const MAX_SUGGESTIONS = 8

// A colon at the start of the text or after a space, then a name that starts with a letter, + or -
// (so ":30" in "at :30" and ":)" are not taken, and "10:30" and "http://" are not either, because the
// colon there follows a character, not a space).
const QUERY = /(^|\s):([a-z+-][a-z0-9_+-]{1,31})$/i

/**
 * Is the cursor at the end of something like ":fir"? `value` is the whole text and `cursor` where the
 * caret is. Returns { startIdx (where the colon is), query ("fir") } or null.
 */
export function detectEmojiQuery(value, cursor) {
  if (typeof value !== 'string' || !Number.isInteger(cursor) || cursor < 0) return null
  const m = QUERY.exec(value.slice(0, cursor))
  if (!m) return null
  return { startIdx: m.index + m[1].length, query: m[2] }
}

// 0 exact, 1 starts with it, 2 contains it, null no match.
const rank = (name, q) => (name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : null)

/**
 * The emoji to offer for what was typed after the colon. `custom` is the workspace's emojis
 * ({ name, dataURL }). Best matches first (exact, then starts-with, then contains); within the same
 * match the workspace's own come before the everyday ones, then by name. Returns items of
 * { kind: 'custom', name, dataURL } or { kind: 'unicode', name (the one that matched), char }.
 */
export function suggestEmojis(query, { custom = [], limit = MAX_SUGGESTIONS } = {}) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (q.length < MIN_QUERY) return []
  const found = []
  for (const e of Array.isArray(custom) ? custom : []) {
    if (typeof e?.name !== 'string' || typeof e.dataURL !== 'string') continue
    const r = rank(e.name.toLowerCase(), q)
    if (r !== null) found.push({ r, order: 0, item: { kind: 'custom', name: e.name, dataURL: e.dataURL } })
  }
  for (const e of UNICODE_EMOJIS) {
    let best = null
    for (const n of e.names) {
      const r = rank(n, q)
      if (r !== null && (best === null || r < best.r)) best = { r, n }
    }
    if (best) found.push({ r: best.r, order: 1, item: { kind: 'unicode', name: best.n, char: e.char } })
  }
  found.sort((a, b) => a.r - b.r || a.order - b.order || a.item.name.localeCompare(b.item.name))
  return found.slice(0, Math.max(0, limit)).map((f) => f.item)
}

/** What gets written for a picked suggestion: the ":name:" token for a custom emoji, the character for an everyday one. */
export const suggestionToken = (item) => (item.kind === 'custom' ? `:${item.name}:` : item.char)

/**
 * The text with the typed ":query" replaced by the picked emoji and a space after it (none if one
 * is already there), and where the caret should go. `startIdx` and `query` come from detectEmojiQuery.
 */
export function applySuggestion(text, startIdx, query, item) {
  const before = text.slice(0, startIdx)
  const after = text.slice(startIdx + 1 + query.length)
  const token = suggestionToken(item)
  const inserted = /^\s/.test(after) ? token : token + ' '
  return { text: before + inserted + after, caret: before.length + inserted.length }
}
