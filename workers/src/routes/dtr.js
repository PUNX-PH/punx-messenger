// DTR reminder: DMs the workspace the day before a cutoff closes, telling
// everyone to submit their DTR and by when.
//
// Replaces a reminder that was sent by hand over Gmail. It reads the cutoff
// from the DTR app's Firestore (a SEPARATE Firebase project, punx-dtr) and
// posts into this one as a bot.
//
// Broadcast, not targeted. The Gmail version opened "Hi Team!" and went to
// everybody, and matching the two user directories is the one genuinely
// fragile part of joining these systems: the projects have separate auth, so
// the same person has a different uid in each, and email is the only join key.
// Anyone whose two accounts differ would silently stop being reminded. A
// broadcast needs no matching at all — it only needs the cutoff's dates.
//
// Doing better than the email IS possible later: submissions are keyed
// `{userId}_{cutoffId}`, so skipping people who already submitted is one read
// each. That reintroduces the matching problem, so it is deliberately not v1.

import { AuthError, verifyAuth } from '../auth.js'
import {
  firestoreGet, firestoreMerge, firestoreQuery, loadServiceAccount,
  mintBotIdToken, serviceAccountToken,
} from '../googleAuth.js'

const MANILA = 'Asia/Manila'
const DTR_APP_URL = 'https://dtr.punxai.online/'

/** `YYYY-MM-DD` for an instant, as it reads on a wall clock in Manila. */
function manilaDate(d) {
  // en-CA formats as YYYY-MM-DD, which is the point of using it here.
  return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA }).format(d)
}

function manilaParts(d, opts) {
  return new Intl.DateTimeFormat('en-US', { timeZone: MANILA, ...opts }).format(d)
}

/** "September 11, 2026" */
const longDate = (d) => manilaParts(d, { month: 'long', day: 'numeric', year: 'numeric' })
/** "August 26" — no year, for the near half of a range that shares one. */
const shortDate = (d) => manilaParts(d, { month: 'long', day: 'numeric' })
/** "Friday" */
const weekday = (d) => manilaParts(d, { weekday: 'long' })
/** "10:00 AM" */
const clockTime = (d) => manilaParts(d, { hour: 'numeric', minute: '2-digit', hour12: true })

/** Shift by whole days without touching the clock time. */
function addDays(d, n) {
  return new Date(d.getTime() + n * 86_400_000)
}

/**
 * The deadline for a cutoff that predates the submitBy field.
 *
 * Mirrors defaultSubmitBy in the DTR app: 10:00 AM the day after the period
 * closes. Only ever reached by cutoffs created before the field existed —
 * every new one carries an explicit value, because the admin form requires it.
 * Worth keeping narrow: a derived deadline is exactly the fiction storing the
 * field was meant to end.
 */
function fallbackSubmitBy(endDate) {
  const next = addDays(endDate, 1)
  // 10:00 Manila is 02:00 UTC. Building it from the Manila calendar date keeps
  // it correct regardless of where this Worker happens to run.
  return new Date(`${manilaDate(next)}T02:00:00.000Z`)
}

/**
 * The heads-up, sent the day before the period closes. This is the message the
 * hand-sent Gmail carried, near enough verbatim.
 */
function buildCutoffMessage(cutoff) {
  const { submitBy } = cutoff
  return [
    'Hi Team!',
    '',
    `Once you complete your attendance for ${periodRange(cutoff)}, please review your DTR and `
    + `submit it through the DTR Web App no later than ${clockTime(submitBy)} on `
    + `${weekday(submitBy)}, ${longDate(submitBy)}.`,
    '',
    `DTR Web App: ${DTR_APP_URL}`,
    '',
    'For reimbursement requests, please upload your completed reimbursement form '
    + 'along with the Official Receipt (OR) or a screenshot of the receipt directly in the web app.',
    '',
    'Thank you!',
  ].join('\n')
}

/**
 * The last call, sent the day before the deadline itself.
 *
 * Deliberately shorter and different in shape from the heads-up. Two DMs a
 * fortnight that open identically train people to stop reading the second one,
 * which is the one that actually matters — so this leads with the time left,
 * drops the reimbursement boilerplate, and says plainly that anyone who has
 * already submitted can ignore it. It cannot know who has, being a broadcast.
 */
function buildDeadlineMessage(cutoff) {
  const { submitBy } = cutoff
  return [
    `Reminder: DTR submissions close tomorrow, ${clockTime(submitBy)} on `
    + `${weekday(submitBy)}.`,
    '',
    `That covers ${periodRange(cutoff)}. If you have already submitted, nothing `
    + 'to do — thanks. If not, this is the last reminder before the cutoff.',
    '',
    `DTR Web App: ${DTR_APP_URL}`,
  ].join('\n')
}

/** "August 26 - September 10, 2026" */
function periodRange({ startDate, endDate }) {
  const sameYear = manilaParts(startDate, { year: 'numeric' }) === manilaParts(endDate, { year: 'numeric' })
  return `${shortDate(startDate)}${sameYear ? '' : `, ${manilaParts(startDate, { year: 'numeric' })}`}`
    + ` - ${longDate(endDate)}`
}

/**
 * The two reminders and the Manila day each falls on.
 *
 * `cutoff` is the heads-up, a day before the period closes — what was always
 * sent. `deadline` is the last call, a day before submissions actually shut.
 * They are separate dates because the deadline is not the end of the period:
 * a period closing Thursday has been due 10am Friday, so the two land on the
 * Wednesday and the Thursday.
 */
function sendDays(cutoff) {
  return {
    cutoff: previousWorkingDay(manilaDate(addDays(cutoff.endDate, -1))),
    deadline: previousWorkingDay(manilaDate(addDays(cutoff.submitBy, -1))),
  }
}

/**
 * Walk a Manila calendar date back to Friday if it lands on a weekend.
 *
 * "The day before the deadline" is only useful if anyone reads it. A deadline
 * of 10:00 Monday puts its last call on the Sunday, where it is seen on Monday
 * morning at the earliest — after the thing it was warning about. Landing on
 * Friday is earlier than asked for and strictly more useful.
 *
 * Applied to BOTH reminders rather than only the one that prompted this: a
 * period ending Sunday would otherwise put its heads-up on a Saturday, and one
 * reminder that avoids weekends while the other does not is the kind of
 * inconsistency nobody remembers the reason for.
 *
 * Holidays are not handled. There is no calendar of them here, and guessing at
 * one would be worse than the honest gap — moving the deadline for a holiday is
 * already why submitBy is a stored field rather than a derived one.
 */
function previousWorkingDay(day) {
  // Noon Manila (04:00 UTC), far from either midnight, so no rounding can move
  // the date across a day boundary while walking backwards.
  let d = new Date(`${day}T04:00:00.000Z`)
  while (isWeekend(d)) d = addDays(d, -1)
  return manilaDate(d)
}

function isWeekend(d) {
  const wd = manilaParts(d, { weekday: 'short' })
  return wd === 'Sat' || wd === 'Sun'
}

/**
 * Which reminder today is, if any.
 *
 * `deadline` wins when both land on the same day, which happens when a cutoff's
 * deadline is the day it closes rather than the day after. Two DMs in one
 * morning saying much the same thing is worse than one, and the last call is
 * the more useful of the two — it names the time remaining.
 */
function kindForToday(cutoff, today) {
  const days = sendDays(cutoff)
  if (today === days.deadline) return 'deadline'
  if (today === days.cutoff) return 'cutoff'
  return null
}

// Each reminder gets its OWN marker, or sending the heads-up would mark the
// cutoff as done and the last call would never go out.
const MARKER_FIELD = { cutoff: 'reminderSentFor', deadline: 'deadlineReminderSentFor' }

/**
 * The cron's kill switch, stored in punx-dtr so the DTR admin owns it.
 *
 * Defaults to ENABLED when the document does not exist, which is the state
 * every install starts in — a missing settings doc must not silently mean "no
 * reminders", because that failure looks exactly like the feature working
 * until someone notices nobody was told.
 */
async function autoSendEnabled(env, dtrSa) {
  const doc = await firestoreGet(env, dtrSa, 'settings/dtrReminder', env.DTR_PROJECT_ID)
  return doc?.autoSendEnabled !== false
}

/** Read the kill switch. Exposed for GET /dtr/auto-send. */
export async function getAutoSend(env) {
  return autoSendEnabled(env, loadServiceAccount(env, 'DTR_SERVICE_ACCOUNT'))
}

/** Flip the kill switch. Exposed for POST /dtr/auto-send. */
export async function setAutoSend(env, enabled) {
  const dtrSa = loadServiceAccount(env, 'DTR_SERVICE_ACCOUNT')
  const token = await serviceAccountToken(env, dtrSa)
  await firestoreMerge(token, env.DTR_PROJECT_ID, 'settings/dtrReminder', {
    autoSendEnabled: enabled,
    updatedAt: new Date(),
  })
  return enabled
}

/**
 * Let a DTR admin through on their own ID token.
 *
 * The token is issued by punx-dtr, not punx-msg, so verifyAuth is told which
 * project to check iss/aud against — this Worker's own project would reject a
 * perfectly valid token.
 *
 * Being signed in is not enough. This DMs the whole workspace, so the caller's
 * role is re-read from punx-dtr on every request rather than trusted from a
 * claim, which means demoting someone takes effect immediately instead of
 * whenever their token happens to expire.
 */
export async function assertDtrAdmin(token, env) {
  const dtrSa = loadServiceAccount(env, 'DTR_SERVICE_ACCOUNT')
  const { uid } = await verifyAuth(token, env, env.DTR_PROJECT_ID)
  const user = await firestoreGet(env, dtrSa, `users/${uid}`, env.DTR_PROJECT_ID)
  if (!user) throw new AuthError('No DTR profile for this account', 403)
  if (!['admin', 'super_admin'].includes(user.role)) {
    throw new AuthError('Only a DTR admin can send the reminder', 403)
  }
  return { uid, role: user.role }
}

/** Newest cutoff in punx-dtr, with its timestamps already parsed. */
async function activeCutoff(env, dtrSa) {
  const rows = await firestoreQuery(env, dtrSa, {
    from: [{ collectionId: 'cutoffs' }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: 1,
  }, env.DTR_PROJECT_ID)
  if (!rows.length) return null

  const c = rows[0]
  if (!c.startDate || !c.endDate) return null
  const endDate = new Date(c.endDate)
  return {
    id: c.id,
    startDate: new Date(c.startDate),
    endDate,
    submitBy: c.submitBy ? new Date(c.submitBy) : fallbackSubmitBy(endDate),
    submitByWasStored: Boolean(c.submitBy),
    reminderSentFor: c.reminderSentFor || null,
    deadlineReminderSentFor: c.deadlineReminderSentFor || null,
  }
}

/**
 * Everyone who should get the DM: real, active people in this workspace.
 *
 * Bots are excluded or the reminder DMs itself, and `deactivated` is the flag a
 * removed member carries — see the roles model. Read with the service account
 * rather than as the bot: this is a directory read, and the bot's identity is
 * only needed for the writes.
 */
async function recipients(env, msgSa, botUid) {
  const users = await firestoreQuery(env, msgSa, {
    from: [{ collectionId: 'users' }],
  })
  return users.filter(u =>
    u.id !== botUid
    && u.type !== 'bot'
    && u.deactivated !== true,
  )
}

/**
 * Post one DM as the bot, creating the conversation if it does not exist.
 *
 * Mirrors ensureDmConvo/sendMessage in src/lib/db.js rather than inventing a
 * shape: the convo id is the two uids sorted and joined with '__', and the
 * parent doc carries members, memberInfo and the lastMessage* fields the
 * sidebar reads. A DM written in a different shape would be invisible in the
 * app even though the document exists.
 */
async function sendDm(env, idToken, bot, user, text) {
  const projectId = env.FIREBASE_PROJECT_ID
  const convoId = [bot.uid, user.id].sort().join('__')
  const now = new Date()

  // merge, so an existing conversation keeps its history and createdAt.
  await firestoreMerge(idToken, projectId, `dms/${convoId}`, {
    members: [bot.uid, user.id].sort(),
    memberInfo: {
      [bot.uid]: { name: bot.name, photoURL: bot.photoURL || null },
      [user.id]: { name: user.name || '', photoURL: user.photoURL || null },
    },
    lastMessageAt: now,
    lastMessageText: text.slice(0, 120),
    lastMessageAuthorUid: bot.uid,
  })

  // A message id has to be unique per send; the cutoff is not enough, because
  // a resend for the same cutoff must not overwrite the first one.
  const msgId = `dtr-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`
  await firestoreMerge(idToken, projectId, `dms/${convoId}/messages/${msgId}`, {
    text,
    imageURL: null,
    imageMeta: null,
    author: { uid: bot.uid, name: bot.name, photoURL: bot.photoURL || null },
    mentionedUids: [],
    replyTo: null,
    createdAt: now,
    pinned: false,
  })
}

/**
 * Run the reminder.
 *
 * `force` skips both the date check and the already-sent guard, for testing.
 * `dryRun` does everything except write, so the message and the recipient
 * count can be seen before anyone is DMed.
 */
export async function runDtrReminder(env, { force = false, dryRun = false, only = null, auto = false, kind = null } = {}) {
  const msgSa = loadServiceAccount(env)
  const dtrSa = loadServiceAccount(env, 'DTR_SERVICE_ACCOUNT')
  const botUid = env.DTR_BOT_UID
  if (!botUid) throw new AuthError('DTR_BOT_UID is unset', 503)

  // The kill switch applies to the CRON only. Someone clicking "send now" has
  // decided; the toggle exists to stop the unattended send, not to disable the
  // button they just pressed.
  if (auto && !(await autoSendEnabled(env, dtrSa))) {
    return { sent: 0, reason: 'auto-send is switched off in the DTR admin' }
  }

  const cutoff = await activeCutoff(env, dtrSa)
  if (!cutoff) return { sent: 0, reason: 'no cutoff found in punx-dtr' }

  // Compared as Manila calendar dates: the cron fires in UTC, and "the day
  // before" is a question about a wall clock, not an instant.
  const today = manilaDate(new Date())
  const days = sendDays(cutoff)
  // An explicit kind is a test asking for one specific message. Without one,
  // the date decides — which is what the cron always wants.
  const todayKind = kindForToday(cutoff, today)
  const which = kind || todayKind || (force ? 'cutoff' : null)

  if (!force && !todayKind) {
    return {
      sent: 0,
      reason: `not a send day (today ${today}; heads-up ${days.cutoff}, last call ${days.deadline})`,
      cutoffId: cutoff.id, sendDays: days,
    }
  }

  // Idempotent per cutoff AND per kind. The cron runs daily and a Worker can be
  // retried, so without this a redeploy DMs everyone twice; with a single
  // shared marker the heads-up would instead suppress the last call entirely.
  if (!force && cutoff[MARKER_FIELD[which]] === cutoff.id) {
    return { sent: 0, reason: `${which} reminder already sent for this cutoff`, cutoffId: cutoff.id }
  }

  const bot = await firestoreGet(env, msgSa, `users/${botUid}`)
  if (!bot) throw new AuthError(`No users/${botUid} doc — is the bot registered?`, 503)
  const botProfile = { uid: botUid, name: bot.name || 'DTR', photoURL: bot.photoURL || null }

  let people = await recipients(env, msgSa, botUid)
  // Single-recipient test. Sending the real thing to yourself is the only way
  // to see what 22 people would see, and is worth having as a first-class mode
  // rather than something done by temporarily breaking the recipient query.
  if (only) {
    // Accepts an email as well as a uid, because nobody knows their own uid and
    // the whole point of this mode is that it be easy to reach for.
    const needle = only.toLowerCase()
    people = people.filter(u => u.id === only || (u.email || '').toLowerCase() === needle)
    if (!people.length) {
      return { sent: 0, reason: `no active user matching "${only}" in punx-msg`, cutoffId: cutoff.id }
    }
  }
  const text = which === 'deadline' ? buildDeadlineMessage(cutoff) : buildCutoffMessage(cutoff)

  // A preview returns BOTH messages, not just today's. Someone checking the
  // wording before a fortnight's reminders go out wants to see everything that
  // will be sent, and neither one is visible on the day the other fires.
  if (dryRun) {
    return {
      sent: 0, dryRun: true, cutoffId: cutoff.id, kind: which,
      wouldSendTo: people.length, sendDays: days,
      submitByWasStored: cutoff.submitByWasStored,
      alreadySent: {
        cutoff: cutoff.reminderSentFor === cutoff.id,
        deadline: cutoff.deadlineReminderSentFor === cutoff.id,
      },
      only: only || undefined,
      text,
      messages: {
        cutoff: buildCutoffMessage(cutoff),
        deadline: buildDeadlineMessage(cutoff),
      },
    }
  }

  const idToken = await mintBotIdToken(env, msgSa, botUid)

  // One failed recipient must not cost everyone else their reminder, so
  // failures are collected rather than thrown. Sent sequentially: this is a
  // few dozen people once a fortnight, and a burst of parallel writes buys
  // nothing but a rate limit.
  let sent = 0
  const failed = []
  for (const user of people) {
    try {
      await sendDm(env, idToken, botProfile, user, text)
      sent += 1
    } catch (e) {
      failed.push({ uid: user.id, error: e.message })
    }
  }

  // Marked only after sending, and on the CUTOFF itself so the DTR side can
  // see it too. Marking up front would lose the whole reminder to one early
  // failure; marking after means a crash mid-run can re-DM the people who
  // already got it, which is the better of the two failures.
  // A single-recipient test must NOT mark the cutoff as reminded, or testing it
  // would silently cancel the real send to everyone else.
  if (sent > 0 && !only) {
    const dtrToken = await serviceAccountToken(env, dtrSa)
    await firestoreMerge(dtrToken, env.DTR_PROJECT_ID, `cutoffs/${cutoff.id}`, {
      [MARKER_FIELD[which]]: cutoff.id,
      [`${MARKER_FIELD[which]}At`]: new Date(),
    }).catch(() => { /* the DMs landed; a failed marker only risks a repeat */ })
  }

  return {
    sent, failed, cutoffId: cutoff.id, kind: which,
    submitByWasStored: cutoff.submitByWasStored,
    only: only || undefined,
    markedSent: sent > 0 && !only,
  }
}
