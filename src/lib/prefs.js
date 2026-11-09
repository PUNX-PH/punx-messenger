// Personal preferences: what there is to choose, what is accepted, and what each
// choice does to the page. No DOM and no Firebase in here, so all of it is tested.
//
// Preferences come from three places (this device's storage, the account, and the
// defaults) and two of them are other people's data as far as this code is
// concerned: an old version of the app, a hand-edited value, or another device
// running newer code could hand over anything. `normalizePrefs` is the one door every
// value goes through, and it accepts only what is on the list below.

import {
  ACCENTS, DEFAULT_ACCENT_HEX, DEFAULT_PALETTE, PALETTES, accentVars, backgroundVars, contrastVars,
} from './palettes.js'
import { hexToRgb, rgbToHex } from './colorMath.js'

export const THEMES = [
  { id: 'auto',  label: 'Auto',  hint: 'Follows your device' },
  { id: 'light', label: 'Light', hint: 'Bright and warm' },
  { id: 'dark',  label: 'Dark',  hint: 'Easy on the eyes' },
]
export const TEXT_SIZES = [
  { id: 'small',   label: 'Small',       scale: '87.5%' },
  { id: 'default', label: 'Default',     scale: null },
  { id: 'large',   label: 'Large',       scale: '112.5%' },
  { id: 'xlarge',  label: 'Extra large', scale: '125%' },
]
export const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact',     label: 'Compact' },
]
export const FONTS = [
  { id: 'inter',    label: 'Inter',    hint: 'The default',                       stack: null },
  { id: 'system',   label: 'System',   hint: 'Your device’s own font',        stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: 'readable', label: 'Readable', hint: 'Atkinson Hyperlegible, easy to tell letters apart', stack: "'Atkinson Hyperlegible', system-ui, sans-serif" },
]
export const CONTRASTS = [
  { id: 'normal', label: 'Standard' },
  { id: 'high',   label: 'Higher contrast' },
]
export const TIME_FORMATS = [
  { id: 'auto', label: 'Automatic' },
  { id: '12h',  label: '12-hour' },
  { id: '24h',  label: '24-hour' },
]
export const SEND_KEYS = [
  { id: 'enter',     label: 'Enter', hint: 'Shift+Enter for a new line' },
  { id: 'mod-enter', label: 'Ctrl+Enter', hint: 'Enter for a new line' },
]
export const GROUP_MINUTES = [
  { id: 0,  label: 'Never' },
  { id: 2,  label: '2 min' },
  { id: 5,  label: '5 min' },
  { id: 15, label: '15 min' },
]

export const DEFAULT_PREFS = Object.freeze({
  theme: 'dark',                 // what the app has always been
  background: DEFAULT_PALETTE,
  accent: null,                  // null = the original blue
  textSize: 'default',
  density: 'comfortable',
  font: 'inter',
  contrast: 'normal',
  reduceMotion: false,
  timeFormat: 'auto',
  sendKey: 'enter',
  groupMinutes: 5,
  tabTitleCount: true,
  updatedAt: 0,                  // when it was last changed, to tell which copy is newer
})

const ids = (list) => list.map(o => o.id)
const oneOf = (value, list, fallback) => (ids(list).includes(value) ? value : fallback)

/** Whatever was handed over, as a complete, valid set of preferences. */
export function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const d = DEFAULT_PREFS

  let accent = null
  if (typeof r.accent === 'string' && hexToRgb(r.accent)) {
    const hex = rgbToHex(hexToRgb(r.accent))
    accent = hex === DEFAULT_ACCENT_HEX ? null : hex
  }
  const updatedAt = Number.isFinite(r.updatedAt) && r.updatedAt > 0 ? Math.floor(r.updatedAt) : 0

  return {
    theme: oneOf(r.theme, THEMES, d.theme),
    background: oneOf(r.background, PALETTES, d.background),
    accent,
    textSize: oneOf(r.textSize, TEXT_SIZES, d.textSize),
    density: oneOf(r.density, DENSITIES, d.density),
    font: oneOf(r.font, FONTS, d.font),
    contrast: oneOf(r.contrast, CONTRASTS, d.contrast),
    reduceMotion: r.reduceMotion === true,
    timeFormat: oneOf(r.timeFormat, TIME_FORMATS, d.timeFormat),
    sendKey: oneOf(r.sendKey, SEND_KEYS, d.sendKey),
    groupMinutes: oneOf(r.groupMinutes, GROUP_MINUTES, d.groupMinutes),
    tabTitleCount: typeof r.tabTitleCount === 'boolean' ? r.tabTitleCount : d.tabTitleCount,
    updatedAt,
  }
}

/**
 * Which of two copies to keep: the one changed last. On a tie keep `local`, so a
 * value this device just wrote and the account sent straight back does nothing.
 * @returns {{ prefs: object, from: 'local' | 'remote' }}
 */
export function newerPrefs(local, remote) {
  if (!remote || typeof remote !== 'object') return { prefs: local, from: 'local' }
  const r = normalizePrefs(remote)
  return r.updatedAt > local.updatedAt ? { prefs: r, from: 'remote' } : { prefs: local, from: 'local' }
}

/** True when nothing differs from the defaults (ignoring when it was changed). */
export function isDefault(prefs) {
  const p = normalizePrefs(prefs)
  return Object.keys(DEFAULT_PREFS).every(k => k === 'updatedAt' || p[k] === DEFAULT_PREFS[k])
}

/** Is the light theme showing, given the choice and what the device prefers? */
export const resolveLight = (theme, systemLight) => theme === 'light' || (theme === 'auto' && !!systemLight)

/**
 * Everything the page needs, worked out once and kept: the colours for BOTH themes
 * (so "Auto" can pick when it knows what the device prefers), plus the settings that
 * are plain attributes. Small enough to store and to read before the app starts, so
 * the page is never shown in the wrong colours first.
 */
export function computeSnapshot(prefs) {
  const p = normalizePrefs(prefs)
  const vars = {}
  for (const mode of ['dark', 'light']) {
    vars[mode] = {
      ...backgroundVars(p.background, mode),
      ...(p.contrast === 'high' ? contrastVars(p.background, mode) : {}),
      ...(p.accent ? accentVars(p.accent, mode, p.background) : {}),
    }
  }
  const font = FONTS.find(f => f.id === p.font)
  return {
    theme: p.theme,
    vars,
    density: p.density === 'compact' ? 'compact' : null,
    motion: p.reduceMotion ? 'reduced' : null,
    fontSize: TEXT_SIZES.find(s => s.id === p.textSize)?.scale ?? null,
    fontStack: font?.stack ?? null,
    font: p.font,
  }
}

// Every variable the preferences can set. Anything on this list that a snapshot does
// not set is removed, so going back to the original leaves nothing behind. It is a
// fixed list, not a record of what this code set earlier, because the script in
// index.html also sets some of them before the app starts, and a record kept here
// would not know about those.
export const MANAGED_VARS = [
  '--bg-deepest', '--bg-dark', '--bg-main', '--bg-raised', '--bg-hover',
  '--line-subtle', '--line-strong', '--ink-muted', '--ink-dim',
  '--brand', '--brand-hover', '--brand-text', '--font-body',
]

/**
 * Puts a snapshot on the page. `root` is <html>; it is passed in so a test can use a
 * stand-in. Managed variables the snapshot does not set are removed.
 * @returns {boolean} whether the light theme is now showing
 */
export function applySnapshot(snap, root, { systemLight = false } = {}) {
  const light = resolveLight(snap.theme, systemLight)
  root.classList.toggle('light', light)

  const next = { ...snap.vars[light ? 'light' : 'dark'] }
  if (snap.fontStack) next['--font-body'] = snap.fontStack
  for (const name of MANAGED_VARS) if (!(name in next)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(next)) root.style.setProperty(name, value)

  if (snap.fontSize) root.style.setProperty('font-size', snap.fontSize)
  else root.style.removeProperty('font-size')

  setAttr(root, 'density', snap.density)
  setAttr(root, 'motion', snap.motion)
  return light
}

function setAttr(root, name, value) {
  if (value) root.dataset[name] = value
  else delete root.dataset[name]
}

/** The stylesheet that provides the "Readable" font, loaded only if it is chosen. */
export const READABLE_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap'

export { ACCENTS, DEFAULT_ACCENT_HEX, PALETTES }
