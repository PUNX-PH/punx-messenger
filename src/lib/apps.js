// The company apps shown under the toolbox icon in the chat header.
//
// To add one, add an entry to WORKSPACE_APPS below and nothing else:
//
//   { id: 'my-app', name: 'My app', description: 'One short line', url: 'https://...', icon: 'clock' }
//
// An entry has EITHER a `url` (a link, opened in a new tab) OR an `action` (one of
// APP_ACTIONS: something inside the messenger, like the calendar widget), never both.
// `icon` is one of APP_ICONS (drawn in src/components/AppsMenu.jsx). Links open
// in a new tab. Most of these are separate apps with their own sign-in (the DTR
// tracker even has its own Firebase project), so people may be asked to sign in
// there; nothing about the messenger session is passed along. No DOM and no
// Firebase in here, so the list is checked by tests.

import { OPEN_CALENDAR_EVENT } from './dtrCalendar.js'

export const APP_ICONS = ['clock', 'calendar', 'app']

// What an `action` entry does: the event it sends on window, which a host component
// (mounted in App.jsx) is listening for.
export const APP_ACTIONS = { calendar: OPEN_CALENDAR_EVENT }

// Who sees the toolbox at all. For now only developers (the role in users/{uid}.role,
// see docs/ROLES.md); to open it up, add roles here, e.g. 'super_admin' or 'employee'.
// This only decides whether the icon is drawn. It is not access control: each app
// is its own site and decides for itself who may use it.
export const APPS_VISIBLE_TO = ['developer']

/** Does this person get the toolbox? */
export const canSeeApps = (profile) => APPS_VISIBLE_TO.includes(profile?.role)

export const WORKSPACE_APPS = [
  {
    id: 'dtr',
    name: 'DTR tracker',
    description: 'Submit your daily time record',
    url: 'https://dtr.punxai.online/',
    icon: 'clock',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Holidays and who is on leave',
    action: 'calendar',
    icon: 'calendar',
  },
]

/** Only a plain https link may be opened: never javascript:, data: or a relative path. */
export function isSafeAppUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** The apps that can be shown: anything malformed is left out rather than breaking the menu. */
export function usableApps(list = WORKSPACE_APPS) {
  const seen = new Set()
  return list.filter(a => {
    if (!a || typeof a.id !== 'string' || !a.id || seen.has(a.id)) return false
    if (typeof a.name !== 'string' || !a.name.trim()) return false
    // A link or an action, not both and not neither.
    const isLink = a.url !== undefined
    const isAction = a.action !== undefined
    if (isLink === isAction) return false
    if (isLink && !isSafeAppUrl(a.url)) return false
    if (isAction && !Object.hasOwn(APP_ACTIONS, a.action)) return false
    seen.add(a.id)
    return true
  })
}
