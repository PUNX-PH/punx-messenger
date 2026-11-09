// The colour choices, turned into the CSS variables the app already reads.
//
// Everything in the app is coloured through variables (see index.css and
// tailwind.config.js), so changing someone's palette is setting a handful of
// variables on <html>; nothing re-renders.
//
// Two rules hold for every combination, and tests/palettes.test.mjs checks them for
// all backgrounds, in both themes, with every accent and with hundreds of arbitrary
// ones (colour is a personal choice, and a pleasant one must never make the app
// unreadable):
//   - text keeps exactly the contrast it was designed to have on every surface;
//   - white text on the accent colour, and accent-coloured text on the surfaces,
//     are at least 4.5:1.
//
// The DEFAULTS (the "Slate" background and the original blue accent) are not
// computed: they leave the stylesheet's own values alone, so someone who never opens
// the preferences sees exactly what the app always looked like.

import {
  contrast, ensureContrast, hexToRgb, luminance, mix, toChannels, withLuminance, rgbToHex,
} from './colorMath.js'

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

// The original palette (src/index.css), as colours. These are the reference every
// other background is matched to.
const LEGACY = {
  dark: {
    bgDeepest: [10, 14, 20], bgDark: [19, 22, 28], bgMain: [26, 30, 38], bgRaised: [34, 39, 47],
    bgHover: [45, 50, 61], lineSubtle: [45, 50, 61], lineStrong: [58, 65, 80],
    ink: [229, 231, 235], inkMuted: [176, 182, 192], inkDim: [148, 156, 170],
  },
  light: {
    bgDeepest: [228, 230, 235], bgDark: [240, 242, 245], bgMain: [255, 255, 255], bgRaised: [247, 248, 250],
    bgHover: [232, 234, 238], lineSubtle: [220, 223, 228], lineStrong: [196, 201, 208],
    ink: [20, 23, 28], inkMuted: [75, 85, 99], inkDim: [90, 98, 112],
  },
}

const SURFACES = ['bgDeepest', 'bgDark', 'bgMain', 'bgRaised', 'bgHover']
const LINES = ['lineSubtle', 'lineStrong']

const CSS_NAMES = {
  bgDeepest: '--bg-deepest', bgDark: '--bg-dark', bgMain: '--bg-main', bgRaised: '--bg-raised',
  bgHover: '--bg-hover', lineSubtle: '--line-subtle', lineStrong: '--line-strong',
  ink: '--ink', inkMuted: '--ink-muted', inkDim: '--ink-dim',
}

/**
 * Backgrounds. Each has one hue; how colourful it is in the dark and the light
 * theme; and, for the light theme, how bright its main surface is (white for the
 * original, a faint tint for the others).
 */
export const PALETTES = [
  { id: 'slate',    label: 'Slate',    hue: 218, darkSat: 0.19, lightSat: 0,    lightMainY: 1 },     // the original
  { id: 'midnight', label: 'Midnight', hue: 232, darkSat: 0.42, lightSat: 0.42, lightMainY: 0.975 },
  { id: 'ocean',    label: 'Ocean',    hue: 192, darkSat: 0.44, lightSat: 0.42, lightMainY: 0.975 },
  { id: 'forest',   label: 'Forest',   hue: 150, darkSat: 0.32, lightSat: 0.30, lightMainY: 0.975 },
  { id: 'berry',    label: 'Berry',    hue: 322, darkSat: 0.36, lightSat: 0.34, lightMainY: 0.975 },
  { id: 'sunset',   label: 'Sunset',   hue: 18,  darkSat: 0.34, lightSat: 0.40, lightMainY: 0.975 },
  { id: 'grape',    label: 'Grape',    hue: 268, darkSat: 0.38, lightSat: 0.34, lightMainY: 0.975 },
  { id: 'charcoal', label: 'Charcoal', hue: 0,   darkSat: 0.02, lightSat: 0,    lightMainY: 1 },
]
export const DEFAULT_PALETTE = 'slate'

/**
 * The accent colours on offer. `blurple` is the original and is not computed.
 * Anything else, including a custom colour, is adjusted as needed to be readable.
 */
export const ACCENTS = [
  { id: 'ember',  label: 'Ember',  hex: '#e8552b' },
  { id: 'amber',  label: 'Amber',  hex: '#d98e04' },
  { id: 'green',  label: 'Green',  hex: '#1fa855' },
  { id: 'teal',   label: 'Teal',   hex: '#14a59a' },
  { id: 'sky',    label: 'Sky',    hex: '#0e92d8' },
  { id: 'blue',   label: 'Blue',   hex: '#3b6ff0' },
  { id: 'violet', label: 'Violet', hex: '#7c4ddb' },
  { id: 'pink',   label: 'Pink',   hex: '#db3a8e' },
  { id: 'rose',   label: 'Rose',   hex: '#e0345a' },
]
// What the original accent looks like, for showing it in the picker.
export const DEFAULT_ACCENT_HEX = '#5865f2'

const palette = (id) => PALETTES.find(p => p.id === id) || PALETTES[0]

/** The surface, line and text colours of a background in a theme, as [r,g,b]. */
export function surfacesFor(id, mode) {
  const base = LEGACY[mode]
  const p = palette(id)
  if (p.id === DEFAULT_PALETTE) return { ...base }
  const sat = mode === 'dark' ? p.darkSat : p.lightSat
  const out = { ...base }
  for (const key of [...SURFACES, ...LINES]) {
    // Same brightness as the original surface, so text contrast is unchanged. The
    // light theme's main surface is the one exception: nudged off pure white to
    // carry the tint. That makes dark text on it very slightly LESS contrasty (about
    // 17.5:1 instead of 18:1, still far above any requirement); tests pin a floor.
    const y = (mode === 'light' && key === 'bgMain')
      ? Math.min(luminance(base[key]), p.lightMainY)
      : luminance(base[key])
    out[key] = withLuminance(p.hue, sat, y)
  }
  return out
}

const varsOf = (colors, keys) => Object.fromEntries(keys.map(k => [CSS_NAMES[k], toChannels(colors[k])]))

/** The variables for a background, or {} for the original (which needs none). */
export function backgroundVars(id, mode) {
  if (palette(id).id === DEFAULT_PALETTE) return {}
  return varsOf(surfacesFor(id, mode), [...SURFACES, ...LINES])
}

/**
 * "Higher contrast": quieter text and edges are pulled toward the main text colour
 * until they reach the stricter 7:1, whatever background is chosen.
 */
export function contrastVars(id, mode) {
  const s = surfacesFor(id, mode)
  const bgs = SURFACES.map(k => s[k])
  const toward = mode === 'dark' ? WHITE : BLACK
  const inkMuted = ensureContrast(s.inkMuted, bgs, 7, toward)
  const inkDim = ensureContrast(s.inkDim, bgs, 7, toward)
  const lineStrong = mix(s.lineStrong, s.ink, 0.55)
  const lineSubtle = mix(s.lineStrong, s.ink, 0.25)
  return {
    '--ink-muted': toChannels(inkMuted),
    '--ink-dim': toChannels(inkDim),
    '--line-subtle': toChannels(lineSubtle),
    '--line-strong': toChannels(lineStrong),
  }
}

/**
 * The accent: the fill (white text sits on it), its darker hover shade, and the
 * lighter-or-darker shade used for accent-coloured TEXT on the surfaces. Each is
 * adjusted until it is readable, so no accent can be chosen that is not.
 */
export function accentVars(hex, mode, backgroundId = DEFAULT_PALETTE) {
  const base = hexToRgb(hex)
  if (!base) return {}
  const s = surfacesFor(backgroundId, mode)
  // 1. The fill: darkened until white text on it reads (a yellow would not otherwise).
  const fill = ensureContrast(base, [WHITE], 4.5, BLACK)
  // 2. Hover is a shade darker, so it keeps the white-text contrast.
  const hover = mix(fill, BLACK, 0.18)
  // 3. Text in the accent colour, on the surfaces. Dark theme: lighter than the fill;
  //    light theme: darker. Checked against the hardest surface for each.
  const surfaces = SURFACES.map(k => s[k])
  const text = ensureContrast(fill, surfaces, 4.5, mode === 'dark' ? WHITE : BLACK)
  return {
    '--brand': toChannels(fill),
    '--brand-hover': toChannels(hover),
    '--brand-text': toChannels(text),
  }
}

/** Exposed for the preview swatches and for tests. */
export const swatch = (id, mode) => rgbToHex(surfacesFor(id, mode).bgMain)
export { contrast }
