// A red badge with the unread count on the browser tab's icon, so it is visible from
// another tab even when the tab title is cut short. The decisions (what the badge says,
// where it sits) are pure and tested; the canvas drawing at the bottom is the only part
// that needs a browser.

/** Past this the badge says "9+": two digits do not stay readable on a 16 px icon. */
export const BADGE_MAX = 9

/** What the badge says: '' for nothing new, "3", or "9+". */
export function badgeLabel(n) {
  const count = Math.floor(Number(n))
  if (!Number.isFinite(count) || count < 1) return ''
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count)
}

/**
 * Where the badge goes on a size x size icon, and how large its text is: a circle tucked
 * into the top-right corner (flush, so none of it is cut off), with a smaller font for the
 * two-character "9+" so it still fits inside.
 */
export function badgeGeometry(size, label) {
  const r = size * 0.32
  return { cx: size - r, cy: r, r, fontPx: Math.round(size * (label.length > 1 ? 0.36 : 0.46)) }
}

/** "239 68 68" (the theme's CSS value) -> "rgb(239,68,68)"; anything else -> the fallback red. */
export function rgbFromTriplet(triplet, fallback = 'rgb(239,68,68)') {
  const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(String(triplet ?? ''))
  if (!m || [m[1], m[2], m[3]].some(v => Number(v) > 255)) return fallback
  return `rgb(${m[1]},${m[2]},${m[3]})`
}

// ---------- the drawing (browser only) ----------

const ICON_SIZE = 64

/** The icon with the badge on it, as a PNG data URL. `image` is the loaded base icon. */
export function renderBadgedIcon(image, label, color) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = ICON_SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE)
  const { cx, cy, r, fontPx } = badgeGeometry(ICON_SIZE, label)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,0.95)' // a ring, so it reads on a dark or a light tab strip
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, cy + 1)
  return canvas.toDataURL('image/png')
}
