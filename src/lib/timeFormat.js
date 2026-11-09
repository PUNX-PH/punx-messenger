// The times shown beside messages, in the person's chosen clock: automatic (their
// device's own habit), 12-hour or 24-hour. Pure, so it is tested; the locale is a
// parameter only so a test gets the same answer anywhere.

const hourCycle = (format) => (format === '12h' ? { hour12: true } : format === '24h' ? { hourCycle: 'h23' } : {})

/**
 * "9:01" for the gutter beside a follow-on message: an avatar's width, so no "AM".
 * Built from parts rather than by cutting a formatted string, so a locale that puts
 * the day period first still works. In 24-hour there is no day period to drop.
 */
export function clockTime(date, format = 'auto', locale = []) {
  if (!date) return ''
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', ...hourCycle(format) })
    .formatToParts(date)
    .filter(p => p.type !== 'dayPeriod')
    .map(p => p.value)
    .join('')
    .trim()
}

/** The time on a message's header: "9:01 AM" or "09:01". The day is on the divider above. */
export function headerTime(date, format = 'auto', locale = []) {
  if (!date) return ''
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...hourCycle(format) })
}

/** The full date and time, for the tooltip. */
export function fullTime(date, format = 'auto', locale = []) {
  if (!date) return ''
  return date.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short', ...hourCycle(format) })
}
