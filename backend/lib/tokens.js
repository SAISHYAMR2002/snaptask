const crypto = require('node:crypto')
const prisma = require('./prisma')

const HOUR = 3600000

const TTL = {
  verify_email: 24 * HOUR,
  reset_password: 1 * HOUR,
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex')

/**
 * Mint a single-use token. Only the hash is stored, so the raw value returned
 * here is the only copy — it goes straight into the email link.
 * Any older unused token of the same type is invalidated first.
 */
async function issueToken(userId, type) {
  await prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  })

  const token = crypto.randomBytes(32).toString('hex')
  await prisma.verificationToken.create({
    data: {
      tokenHash: hash(token),
      type,
      userId,
      expiresAt: new Date(Date.now() + (TTL[type] || HOUR)),
    },
  })
  return token
}

/**
 * Check a token and burn it. Returns { userId } or { error }.
 * A token is only good once, for its own type, before it expires.
 */
async function consumeToken(token, type) {
  if (!token || typeof token !== 'string') return { error: 'Missing token' }

  const row = await prisma.verificationToken.findUnique({ where: { tokenHash: hash(token) } })
  if (!row || row.type !== type) return { error: 'That link is not valid' }
  if (row.usedAt) return { error: 'That link has already been used' }
  if (row.expiresAt < new Date()) return { error: 'That link has expired — request a new one' }

  await prisma.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } })
  return { userId: row.userId }
}

module.exports = { issueToken, consumeToken }
