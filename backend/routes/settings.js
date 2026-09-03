const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { getPrefs } = require('../lib/notify')
const { sendEmail, wrap } = require('../lib/mailer')

const router = express.Router()
router.use(auth)

const BOOLEANS = [
  'emailAssigned',
  'emailMention',
  'emailComment',
  'emailStatus',
  'dailyDigest',
  'weeklyReport',
  'remindBeforeDue',
  'nudgeOverdue',
]

// GET /settings/prefs
router.get('/prefs', async (req, res) => {
  const prefs = await getPrefs(req.userId)
  res.json({ prefs, emailConfigured: Boolean(process.env.RESEND_API_KEY) })
})

// PATCH /settings/prefs
router.patch('/prefs', async (req, res) => {
  await getPrefs(req.userId) // make sure the row exists

  const data = {}
  for (const key of BOOLEANS) {
    if (typeof req.body[key] === 'boolean') data[key] = req.body[key]
  }
  if (Number.isInteger(req.body.digestHour) && req.body.digestHour >= 0 && req.body.digestHour <= 23) {
    data.digestHour = req.body.digestHour
  }
  if (Number.isInteger(req.body.remindHours) && req.body.remindHours > 0 && req.body.remindHours <= 168) {
    data.remindHours = req.body.remindHours
  }

  const prefs = await prisma.notificationPrefs.update({ where: { userId: req.userId }, data })
  res.json({ prefs })
})

// POST /settings/test-email — proves the email pipeline end to end
router.post('/test-email', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  const result = await sendEmail({
    to: user.email,
    subject: 'SnapTask test email',
    html: wrap('It works', 'Your SnapTask email settings are wired up correctly.'),
    text: 'Your SnapTask email settings are wired up correctly.',
  })
  res.json({ to: user.email, ...result })
})

module.exports = router
