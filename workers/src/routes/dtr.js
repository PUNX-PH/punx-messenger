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

import { AuthError } from '../auth.js'
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

function buildMessage(cutoff) {
  const { startDate, endDate, submitBy } = cutoff
  const sameYear = manilaParts(startDate, { year: 'numeric' }) === manilaParts(endDate, { year: 'numeric' })
  const range = `${shortDate(startDate)}${sameYear ? '' : `, ${manilaParts(startDate, { year: 'numeric' })}`}`
    + ` - ${longDate(endDate)}`

  return [
    'Hi Team!',
    '',
    `Once you complete your attendance for ${range}, please review your DTR and `
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
export async function runDtrReminder(env, { force = false, dryRun = false } = {}) {
  const msgSa = loadServiceAccount(env)
  const dtrSa = loadServiceAccount(env, 'DTR_SERVICE_ACCOUNT')
  const botUid = env.DTR_BOT_UID
  if (!botUid) throw new AuthError('DTR_BOT_UID is unset', 503)

  const cutoff = await activeCutoff(env, dtrSa)
  if (!cutoff) return { sent: 0, reason: 'no cutoff found in punx-dtr' }

  // Send the day before the period closes. That is what the hand-sent email
  // did: a period ending Thu Sep 10 was reminded on Wed Sep 9, two days ahead
  // of the Friday deadline. Compared as Manila calendar dates, because the
  // cron fires in UTC and "the day before" is a question about a wall clock.
  const sendOn = manilaDate(addDays(cutoff.endDate, -1))
  const today = manilaDate(new Date())
  if (!force && today !== sendOn) {
    return { sent: 0, reason: `not the send day (today ${today}, sends ${sendOn})`, cutoffId: cutoff.id }
  }

  // Idempotent by cutoff. The cron runs daily and a Worker can be retried, so
  // without this a redeploy or a retried invocation DMs everyone twice.
  if (!force && cutoff.reminderSentFor === cutoff.id) {
    return { sent: 0, reason: 'already sent for this cutoff', cutoffId: cutoff.id }
  }

  const bot = await firestoreGet(env, msgSa, `users/${botUid}`)
  if (!bot) throw new AuthError(`No users/${botUid} doc — is the bot registered?`, 503)
  const botProfile = { uid: botUid, name: bot.name || 'DTR', photoURL: bot.photoURL || null }

  const people = await recipients(env, msgSa, botUid)
  const text = buildMessage(cutoff)

  if (dryRun) {
    return {
      sent: 0, dryRun: true, cutoffId: cutoff.id,
      wouldSendTo: people.length, sendOn, submitByWasStored: cutoff.submitByWasStored, text,
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
  if (sent > 0) {
    const dtrToken = await serviceAccountToken(env, dtrSa)
    await firestoreMerge(dtrToken, env.DTR_PROJECT_ID, `cutoffs/${cutoff.id}`, {
      reminderSentFor: cutoff.id,
      reminderSentAt: new Date(),
    }).catch(() => { /* the DMs landed; a failed marker only risks a repeat */ })
  }

  return { sent, failed, cutoffId: cutoff.id, submitByWasStored: cutoff.submitByWasStored }
}
