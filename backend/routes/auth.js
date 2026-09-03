const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { issueToken, consumeToken } = require('../lib/tokens')
const { sendEmail, wrap } = require('../lib/mailer')
const { rateLimit, reset, envLimit } = require('../lib/ratelimit')
const { validateEmail, validatePassword, validateName, normalizeEmail } = require('../lib/validate')
const { logger } = require('../lib/logger')

const router = express.Router()

const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const EMAIL_LIVE = Boolean(process.env.RESEND_API_KEY)

// Shape a user row for the client — never include the password hash.
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatar: u.avatar,
  emailVerified: u.emailVerified,
  createdAt: u.createdAt,
})

const makeToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' })

/**
 * In dev (no mail provider configured) the link is returned in the response so
 * the flow is testable without a mailbox. With RESEND_API_KEY set this never
 * happens — the link only exists in the email.
 */
const devLink = (url) => (EMAIL_LIVE ? undefined : url)

/**
 * Mint the link now (fast, one insert) and hand the email to the mail provider
 * in the BACKGROUND. Nobody should wait ~500ms on an external API before their
 * signup returns; the token is already valid the moment this resolves.
 */
async function sendVerifyEmail(user) {
  const token = await issueToken(user.id, 'verify_email')
  const url = `${APP_URL}/verify-email?token=${token}`

  sendEmail({
    to: user.email,
    subject: 'Confirm your SnapTask email',
    html: wrap('Confirm your email', `Hi ${user.name}, confirm your address to finish setting up your account. This link is good for 24 hours.`, url),
    text: `Confirm your SnapTask email: ${url}`,
  }).catch((err) => logger.warn('verification email failed', { component: 'auth', err: err.message }))

  return url
}

/* ----------------------------- signup ----------------------------- */

router.post(
  '/signup',
  // generous enough for a whole office behind one NAT address; tune with RL_SIGNUP
  rateLimit({ name: 'signup', limit: envLimit('SIGNUP', 30), windowSec: 3600 }),
  async (req, res) => {
    const name = validateName(req.body.name)
    if (name.error) return res.status(400).json({ error: name.error })
    const email = validateEmail(req.body.email)
    if (email.error) return res.status(400).json({ error: email.error })
    const password = validatePassword(req.body.password)
    if (password.error) return res.status(400).json({ error: password.error })

    // email is already normalised (lower-cased + trimmed) by validateEmail,
    // so this catches "Foo@Bar.com" vs "foo@bar.com"
    const existing = await prisma.user.findUnique({ where: { email: email.value } })
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' })

    const passwordHash = await bcrypt.hash(password.value, 10)
    const user = await prisma.user.create({
      data: { name: name.value, email: email.value, password: passwordHash, prefs: { create: {} } },
    })

    const url = await sendVerifyEmail(user)
    res.status(201).json({ user: publicUser(user), token: makeToken(user.id), verifyUrl: devLink(url) })
  },
)

/* ------------------------------ login ------------------------------ */

router.post(
  '/login',
  // per IP+email so one attacker can't lock out a whole office
  rateLimit({ name: 'login', limit: envLimit('LOGIN', 8), windowSec: 900, by: (req) => normalizeEmail(req.body?.email) }),
  async (req, res) => {
    const email = normalizeEmail(req.body.email)
    const { password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' })

    const user = await prisma.user.findUnique({ where: { email } })
    // identical response whether the email or the password is wrong,
    // so nobody can probe which addresses have accounts
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    await reset('login', req, email)
    res.json({ user: publicUser(user), token: makeToken(user.id) })
  },
)

/* ------------------------------- me -------------------------------- */

router.get('/me', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: publicUser(user) })
})

router.patch('/profile', auth, async (req, res) => {
  const name = validateName(req.body.name)
  if (name.error) return res.status(400).json({ error: name.error })
  const user = await prisma.user.update({ where: { id: req.userId }, data: { name: name.value } })
  res.json({ user: publicUser(user) })
})

/* ------------------------ email verification ------------------------ */

router.post('/verify-email', async (req, res) => {
  const result = await consumeToken(req.body.token, 'verify_email')
  if (result.error) return res.status(400).json({ error: result.error })

  const user = await prisma.user.update({
    where: { id: result.userId },
    data: { emailVerified: true, verifiedAt: new Date() },
  })
  res.json({ user: publicUser(user) })
})

router.post(
  '/resend-verification',
  auth,
  rateLimit({ name: 'resend', limit: 3, windowSec: 900 }),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.emailVerified) return res.status(400).json({ error: 'Your email is already verified' })

    const url = await sendVerifyEmail(user)
    res.json({ ok: true, sentTo: user.email, verifyUrl: devLink(url) })
  },
)

/* ------------------------- password reset -------------------------- */

router.post(
  '/forgot-password',
  rateLimit({ name: 'forgot', limit: envLimit('FORGOT', 10), windowSec: 900 }),
  async (req, res) => {
    const email = normalizeEmail(req.body.email)
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null

    let url
    if (user) {
      const token = await issueToken(user.id, 'reset_password')
      url = `${APP_URL}/reset-password?token=${token}`
      // background send — the response must not reveal timing differences
      // between a known and an unknown address either
      sendEmail({
        to: user.email,
        subject: 'Reset your SnapTask password',
        html: wrap('Reset your password', 'Click below to choose a new password. This link expires in 1 hour. If you did not ask for this, ignore this email.', url),
        text: `Reset your SnapTask password: ${url}`,
      }).catch((err) => logger.warn('reset email failed', { component: 'auth', err: err.message }))
    }

    // Always the same answer, whether or not that account exists —
    // otherwise this endpoint becomes a way to discover who has an account.
    res.json({
      ok: true,
      message: 'If an account exists for that email, a reset link is on its way.',
      resetUrl: devLink(url),
    })
  },
)

router.post(
  '/reset-password',
  rateLimit({ name: 'reset', limit: 10, windowSec: 900 }),
  async (req, res) => {
    const password = validatePassword(req.body.password)
    if (password.error) return res.status(400).json({ error: password.error })

    const result = await consumeToken(req.body.token, 'reset_password')
    if (result.error) return res.status(400).json({ error: result.error })

    const passwordHash = await bcrypt.hash(password.value, 10)
    // Completing a reset proves they control the mailbox, so this also
    // verifies the email — done in ONE update so the response reflects it.
    const user = await prisma.user.update({
      where: { id: result.userId },
      data: { password: passwordHash, emailVerified: true, verifiedAt: new Date() },
    })

    res.json({ ok: true, user: publicUser(user), token: makeToken(user.id) })
  },
)

router.post('/change-password', auth, async (req, res) => {
  const next = validatePassword(req.body.newPassword)
  if (next.error) return res.status(400).json({ error: next.error })

  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  const ok = await bcrypt.compare(req.body.currentPassword || '', user.password)
  if (!ok) return res.status(401).json({ error: 'Your current password is not correct' })
  if (req.body.currentPassword === req.body.newPassword) {
    return res.status(400).json({ error: 'The new password must be different' })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(next.value, 10) },
  })
  res.json({ ok: true })
})

module.exports = router
