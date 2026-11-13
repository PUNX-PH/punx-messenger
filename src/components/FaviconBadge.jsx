import { useEffect } from 'react'
import { useUnreadCount } from '../lib/useUnreadCount'
import { badgeLabel, renderBadgedIcon, rgbFromTriplet } from '../lib/faviconBadge'
import { usePrefs } from '../lib/usePrefs'

// The page's own icon, remembered once: after the first swap the link would already hold
// a badged picture.
let originalHref = null
const iconLink = () => document.querySelector('link[rel="icon"]')

// The loaded base icon, kept so a count that changes does not fetch it again.
let baseImage = null
function loadBase(href) {
  if (baseImage) return Promise.resolve(baseImage)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { baseImage = img; resolve(img) }
    img.onerror = reject
    img.src = href
  })
}

/**
 * Puts a red badge with the number of conversations with something new on the browser
 * tab's icon, the same number as the tab title (and switched by the same preference).
 * Renders nothing. Mounted once, beside the routes, while signed in. If anything about
 * the drawing fails, the plain icon stays: a missing badge is not worth an error.
 */
export default function FaviconBadge() {
  const count = useUnreadCount()
  const [{ tabTitleCount }] = usePrefs()
  const label = badgeLabel(tabTitleCount ? count : 0)

  useEffect(() => {
    const link = iconLink()
    if (!link) return
    originalHref ??= link.getAttribute('href')
    if (!label) { link.setAttribute('href', originalHref); return }
    let cancelled = false
    const color = rgbFromTriplet(getComputedStyle(document.documentElement).getPropertyValue('--bad'))
    loadBase(originalHref)
      .then(img => { if (!cancelled) link.setAttribute('href', renderBadgedIcon(img, label, color)) })
      .catch(() => { if (!cancelled) link.setAttribute('href', originalHref) })
    return () => { cancelled = true }
  }, [label])

  // Back to the plain icon when signed out or unmounted, so the login page never carries a badge.
  useEffect(() => () => {
    const link = iconLink()
    if (link && originalHref) link.setAttribute('href', originalHref)
  }, [])

  return null
}
