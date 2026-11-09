// Small colour maths, no dependencies: just what is needed to make sure a colour
// someone picks can still be read.
//
// Colours are [r, g, b] with each channel 0-255. Contrast is the WCAG ratio
// ((lighter + 0.05) / (darker + 0.05)) of relative luminance; 4.5 is the minimum
// for normal-size text and 7 is the stricter "AAA" level.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** "#abc" or "#aabbcc" (the # optional) -> [r, g, b], or null if it is not a colour. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')

/** The form the CSS variables hold: space-separated channels, "88 101 242". */
export const toChannels = ([r, g, b]) => [r, g, b].map(v => clamp(Math.round(v), 0, 255)).join(' ')

/** [r,g,b] -> [hue 0-360, saturation 0-1, lightness 0-1]. */
export function rgbToHsl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === R) h = ((G - B) / d) % 6
  else if (max === G) h = (B - R) / d + 2
  else h = (R - G) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

/** [hue 0-360, saturation 0-1, lightness 0-1] -> [r,g,b] (rounded). */
export function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [r + m, g + m, b + m].map(v => Math.round(clamp(v, 0, 1) * 255))
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** t = 0 gives a, t = 1 gives b. */
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/**
 * The colour with this hue and saturation whose luminance is `targetY`. Surfaces of
 * a different hue are made equally bright as the original, so text has exactly the
 * contrast on them that it was designed to have (equal HSL lightness is not equal
 * brightness: green at the same lightness is far brighter than blue).
 */
export function withLuminance(hue, sat, targetY) {
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (luminance(hslToRgb([hue, sat, mid])) < targetY) lo = mid
    else hi = mid
  }
  return hslToRgb([hue, sat, (lo + hi) / 2])
}

/**
 * Moves `fg` toward `toward` (white or black) until it has at least `min` contrast
 * against EVERY background in `bgs`. Returns it unchanged if it already does, and
 * the extreme end if nothing short of it will (white on white cannot be fixed).
 */
export function ensureContrast(fg, bgs, min, toward) {
  const worst = (c) => Math.min(...bgs.map(bg => contrast(c, bg)))
  if (worst(fg) >= min) return fg
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const c = mix(fg, toward, t)
    if (worst(c) >= min) return c
  }
  return toward
}
