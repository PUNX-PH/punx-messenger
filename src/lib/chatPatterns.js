// The chat background patterns: what there is to choose, and the drawing of each.
//
// Every pattern is a black-on-transparent SVG used as a CSS mask, so what shows is
// the page's own text colour at a low opacity. That is what keeps a pattern the
// right colour in every theme and background without a copy per theme, and why
// nothing here may use a colour. No DOM and no Firebase in here.
//
// src/patterns.css is GENERATED from this file:
//
//   node scripts/gen-patterns.mjs
//
// tests/chat-patterns.test.mjs fails if the two disagree, so a pattern cannot be
// added here and forgotten there.

const INK = "#000"
const stroke = (w = 1.2) => `fill='none' stroke='${INK}' stroke-width='${w}' stroke-linecap='round' stroke-linejoin='round'`

// The Punx wordmark, drawn from the logo (public/logo-punx.png): four bold letters
// 39 units tall with 9-unit strokes and wide gaps, 198 units wide. It is one set of
// solid shapes, never see-through ones, so overlapping strokes (the N, the X) cannot
// show as brighter patches when the whole thing is faded.
export const MARK_W = 198
export const MARK_H = 39
const MARK = `<g fill='${INK}'><rect width='9' height='39'/><rect x='108' width='9' height='39'/><rect x='134' width='9' height='39'/><polygon points='108,0 118.5,0 143,39 131.5,39'/><polygon points='161,0 172.5,0 198,39 186.5,39'/><polygon points='186.5,0 198,0 172.5,39 161,39'/></g><g fill='none' stroke='${INK}' stroke-width='9'><path d='M4.5 4.5H19.5A9 9 0 0 1 19.5 22.5H4.5'/><path d='M56.5 0V21.5A13 13 0 0 0 82.5 21.5V0'/></g>`
const mark = (x, y, width) => `<g transform='translate(${x} ${y}) scale(${(width / MARK_W).toFixed(4)})'>${MARK}</g>`

// A grid of square "pixels" from rows of text, for the game-development pattern.
function pixels(rows, x, y, s) {
  let out = ''
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === 'X') out += `<rect x='${x + c * s}' y='${y + r * s}' width='${s}' height='${s}'/>`
  }))
  return `<g fill='${INK}'>${out}</g>`
}

/**
 * kind 'tile'   repeats at w x h
 * kind 'corner' one mark, bottom right, above the message box
 * kind 'center' one mark, in the middle
 * strength      1 for a fine texture; a little more for a single large shape, which
 *               reads fainter than a texture of the same opacity
 */
export const CHAT_PATTERNS = [
  { id: 'none', label: 'None', group: 'Simple' },

  // ----- Simple -----
  { id: 'dots', label: 'Dots', group: 'Simple', kind: 'tile', w: 14, h: 14,
    body: `<circle cx='7' cy='7' r='1.1' fill='${INK}'/>` },
  { id: 'grid', label: 'Grid', group: 'Simple', kind: 'tile', w: 24, h: 24,
    body: `<path d='M0 .5H24M.5 0V24' fill='none' stroke='${INK}' stroke-width='1' shape-rendering='crispEdges'/>` },
  { id: 'ruled', label: 'Ruled', group: 'Simple', kind: 'tile', w: 26, h: 26,
    body: `<path d='M0 25.5H26' fill='none' stroke='${INK}' stroke-width='1' shape-rendering='crispEdges'/>` },
  { id: 'diagonal', label: 'Diagonal', group: 'Simple', kind: 'tile', w: 12, h: 12,
    body: `<path d='M0 12L12 0M-3 3L3 -3M9 15L15 9' ${stroke(1)}/>` },
  { id: 'crosses', label: 'Crosses', group: 'Simple', kind: 'tile', w: 28, h: 28,
    body: `<path d='M14 10v8M10 14h8' ${stroke(1)}/>` },
  { id: 'contours', label: 'Contours', group: 'Simple', kind: 'tile', w: 90, h: 30,
    body: `<path d='M0 15Q22.5 3 45 15T90 15' ${stroke(1)}/>` },

  // ----- Punx -----
  { id: 'punx-corner', label: 'Punx corner', group: 'Punx', kind: 'corner', strength: 1.25, w: MARK_W, h: MARK_H,
    body: mark(0, 0, MARK_W) },
  { id: 'punx-center', label: 'Punx centre', group: 'Punx', kind: 'center', strength: 1.25, w: MARK_W, h: MARK_H,
    body: mark(0, 0, MARK_W) },
  { id: 'punx-pattern', label: 'Punx pattern', group: 'Punx', kind: 'tile', w: 140, h: 76,
    body: mark(10, 12, 56) + mark(80, 50, 56) },

  // ----- Teams -----
  // One small drawing per team, scattered so the repeat does not read as a grid.
  { id: 'creatives', label: 'Creatives', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: `<g ${stroke()}><circle cx='24' cy='26' r='8'/><path d='M82 14L94 36H70Z'/><rect x='18' y='76' width='14' height='14' transform='rotate(15 25 83)'/><path d='M68 88q5 -10 10 0t10 0t10 0'/><circle cx='100' cy='62' r='2.2' fill='${INK}'/><path d='M50 56l5 5M55 56l-5 5'/></g>` },
  { id: 'art2d', label: '2D artists', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: `<g ${stroke(1.1)}><path d='M14 96C30 18 74 14 100 84'/><path d='M14 96L30 22M100 84L72 24' stroke-dasharray='2 3'/><rect x='11' y='93' width='6' height='6' fill='${INK}'/><rect x='97' y='81' width='6' height='6' fill='${INK}'/><circle cx='30' cy='22' r='2.4'/><circle cx='72' cy='24' r='2.4'/></g>` },
  { id: 'art3d', label: '3D artists', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: `<g ${stroke(1.2)}><path d='M60 36L80 48V72L60 84L40 72V48Z'/><path d='M40 48L60 60L80 48M60 60V84'/></g><g fill='${INK}'><circle cx='12' cy='14' r='1.6'/><circle cx='108' cy='104' r='1.6'/></g>` },
  { id: 'ailabs', label: 'AI Labs', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: `<g ${stroke(1)}><path d='M14 20L50 12L92 28L30 64L70 58L108 70L20 104L62 100L100 108M50 12L30 64M50 12L70 58M92 28L70 58M92 28L108 70M30 64L20 104M30 64L62 100M70 58L62 100M108 70L100 108'/></g><g fill='${INK}'><circle cx='14' cy='20' r='2.6'/><circle cx='50' cy='12' r='2.6'/><circle cx='92' cy='28' r='2.6'/><circle cx='30' cy='64' r='2.6'/><circle cx='70' cy='58' r='2.6'/><circle cx='108' cy='70' r='2.6'/><circle cx='20' cy='104' r='2.6'/><circle cx='62' cy='100' r='2.6'/><circle cx='100' cy='108' r='2.6'/></g>` },
  { id: 'gamedev', label: 'Game dev', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: pixels(['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], 14, 14, 4)
      + pixels(['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..'], 80, 22, 4)
      + pixels(['.X.', 'XXX', '.X.'], 24, 80, 6)
      + pixels(['XX', 'XX'], 86, 84, 6) },
  { id: 'hr', label: 'HR', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: `<g ${stroke()}><circle cx='24' cy='22' r='5.5'/><path d='M13 44a11 11 0 0 1 22 0'/><circle cx='80' cy='70' r='5.5'/><path d='M69 92a11 11 0 0 1 22 0'/><path d='M76 12h22a4 4 0 0 1 4 4v10a4 4 0 0 1 -4 4H86l-6 6v-6h-4a4 4 0 0 1 -4 -4V16a4 4 0 0 1 4 -4Z'/><path d='M24 96c-9 -6 -12 -11 -9 -15a5 5 0 0 1 9 1a5 5 0 0 1 9 -1c3 4 0 9 -9 15Z'/></g>` },
  { id: 'dev', label: 'Engineering', group: 'Teams', kind: 'tile', w: 120, h: 120,
    body: `<g ${stroke()}><path d='M16 20L8 28L16 36M30 38L38 18M52 20L60 28L52 36'/><path d='M76 70q-6 0 -6 6v4q0 4 -4 4q4 0 4 4v4q0 6 6 6M96 70q6 0 6 6v4q0 4 4 4q-4 0 -4 4v4q0 6 -6 6'/><path d='M16 82L24 88L16 94M28 96H38'/></g>` },
]

export const PATTERN_GROUPS = ['Simple', 'Punx', 'Teams']

export const PATTERN_STRENGTHS = [
  { id: 'subtle', label: 'Subtle', alpha: 0.045 },
  { id: 'normal', label: 'Normal', alpha: 0.07 },
  { id: 'strong', label: 'Strong', alpha: 0.12 },
]

export const patternIds = () => CHAT_PATTERNS.map(p => p.id)

/** The drawing of one pattern as a standalone SVG string (for the picker's thumbnails). */
export function patternSvg(p) {
  if (!p.body) return ''
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${p.w}' height='${p.h}' viewBox='0 0 ${p.w} ${p.h}'>${p.body}</svg>`
}

export const dataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg)
  .replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',')

/** The whole of src/patterns.css. */
export function patternsCss() {
  const out = []
  out.push('/* GENERATED by scripts/gen-patterns.mjs from src/lib/chatPatterns.js. Do not edit by hand. */')
  out.push('')
  out.push('/* The chat background: a faint pattern behind the messages, drawn as a mask so it takes the')
  out.push('   text colour of whatever theme and background is showing. Hidden by the "Higher contrast"')
  out.push('   setting (src/lib/prefs.js removes the attribute). */')
  out.push('html[data-pattern] .chat-pattern { position: relative; isolation: isolate; }')
  out.push('html[data-pattern] .chat-pattern::before {')
  out.push("  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;")
  out.push('  background-color: rgb(var(--ink) / calc(var(--pat-a, 0.07) * var(--pat-k, 1)));')
  out.push('  -webkit-mask-image: var(--pat-img); mask-image: var(--pat-img);')
  out.push('  -webkit-mask-repeat: repeat; mask-repeat: repeat;')
  out.push('}')
  for (const s of PATTERN_STRENGTHS.filter(s => s.id !== 'normal')) {
    out.push(`html[data-pattern-strength="${s.id}"] .chat-pattern { --pat-a: ${s.alpha}; }`)
  }
  for (const p of CHAT_PATTERNS.filter(p => p.body)) {
    const rule = [`--pat-img: url("${dataUri(patternSvg(p))}");`]
    if (p.strength && p.strength !== 1) rule.push(`--pat-k: ${p.strength};`)
    if (p.kind === 'tile') rule.push(`-webkit-mask-size: ${p.w}px ${p.h}px; mask-size: ${p.w}px ${p.h}px;`)
    if (p.kind === 'corner') {
      rule.push('-webkit-mask-size: min(11rem, 45%) auto; mask-size: min(11rem, 45%) auto;')
      rule.push('-webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;')
      rule.push('-webkit-mask-position: right 1.25rem bottom 1rem; mask-position: right 1.25rem bottom 1rem;')
    }
    if (p.kind === 'center') {
      rule.push('-webkit-mask-size: min(26rem, 70%) auto; mask-size: min(26rem, 70%) auto;')
      rule.push('-webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;')
      rule.push('-webkit-mask-position: center; mask-position: center;')
    }
    // --pat-img and --pat-k are set on the element, the mask properties on its ::before.
    const vars = rule.filter(r => r.startsWith('--'))
    const props = rule.filter(r => !r.startsWith('--'))
    out.push(`html[data-pattern="${p.id}"] .chat-pattern { ${vars.join(' ')} }`)
    if (props.length) out.push(`html[data-pattern="${p.id}"] .chat-pattern::before { ${props.join(' ')} }`)
  }
  return out.join('\n') + '\n'
}
