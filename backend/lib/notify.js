const prisma = require('./prisma')
const { sendEmail, wrap } = require('./mailer')

const APP_URL = process.env.APP_URL || 'http://localhost:5173'

// which preference switch governs which notification type
const PREF_FOR_TYPE = {
  assigned: 'emailAssigned',
  mention: 'emailMention',
  comment: 'emailComment',
  status: 'emailStatus',
  due: 'remindBeforeDue',
  overdue: 'nudgeOverdue',
}

/** Every user gets a preferences row; create it lazily if missing. */
async function getPrefs(userId) {
  const existing = await prisma.notificationPrefs.findUnique({ where: { userId } })
  if (existing) return existing
  return prisma.notificationPrefs.create({ data: { userId } })
}

/**
 * Create one in-app notification and, if the recipient's preferences allow it,
 * send the matching email. Never notifies the person who caused the event.
 */
async function notify({ userId, actorId, type, title, body, taskId, workspaceId, channelId, link }) {
  if (!userId || userId === actorId) return null

  const notification = await prisma.notification.create({
    data: { userId, type, title, body: body || null, taskId: taskId || null, workspaceId: workspaceId || null, channelId: channelId || null },
  })

  // Email is sent in the BACKGROUND, deliberately not awaited. Talking to the
  // mail provider takes a few hundred milliseconds; making the person who
  // clicked "comment" wait for someone else's email is the wrong trade.
  // The in-app notification above is already saved, so nothing is lost if the
  // send fails — and a failure can never break the request that triggered it.
  ;(async () => {
    try {
      const prefs = await getPrefs(userId)
      const key = PREF_FOR_TYPE[type]
      if (!key || !prefs[key]) return

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
      if (!user) return

      await sendEmail({
        to: user.email,
        subject: title,
        html: wrap(title, body || '', link || APP_URL),
        text: `${title}\n\n${body || ''}\n\n${link || APP_URL}`,
      })
    } catch (err) {
      console.error('[notify] background email failed:', err.message)
    }
  })()

  return notification
}

/**
 * Find "@Name" mentions in text and return the ids of workspace members matched.
 * Longest names are matched first so "@Sara Kim" wins over "@Sara".
 */
function findMentions(text, members) {
  if (!text) return []
  const hits = new Set()
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length)
  for (const m of sorted) {
    const needle = '@' + m.name.toLowerCase()
    if (text.toLowerCase().includes(needle)) hits.add(m.id)
  }
  return [...hits]
}

module.exports = { notify, getPrefs, findMentions, APP_URL }
