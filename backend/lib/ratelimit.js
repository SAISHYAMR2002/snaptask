const Redis = require('ioredis')

/**
 * Rate limiting, backed by Redis.
 *
 * Redis is the right store for this because the counter has to be shared by
 * every server process — an in-memory counter resets on deploy and doesn't
 * work once you run more than one instance. If Redis is unreachable we fall
 * back to an in-process Map so the app still runs (just less strictly).
 */
let redis = null
let redisReady = false

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  })
  redis.on('ready', () => { redisReady = true; console.log('[ratelimit] using Redis') })
  redis.on('error', (err) => {
    if (redisReady) console.error('[ratelimit] redis error:', err.message)
    redisReady = false
  })
}

// fallback store: key -> { count, resetAt }
const memory = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k)
}, 60000).unref?.()

async function hit(key, windowSec) {
  if (redis && redisReady) {
    try {
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, windowSec)
      const ttl = await redis.ttl(key)
      return { count, retryAfter: ttl > 0 ? ttl : windowSec }
    } catch {
      /* fall through to memory */
    }
  }
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return { count: 1, retryAfter: windowSec }
  }
  entry.count++
  return { count: entry.count, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown').trim()

/**
 * rateLimit({ name, limit, windowSec, by })
 *   by(req) -> extra key part (e.g. the submitted email), optional
 */
function rateLimit({ name, limit, windowSec, by }) {
  return async (req, res, next) => {
    try {
      const extra = by ? by(req) : ''
      const key = `rl:${name}:${clientIp(req)}${extra ? ':' + extra : ''}`
      const { count, retryAfter } = await hit(key, windowSec)

      res.setHeader('X-RateLimit-Limit', limit)
      res.setHeader('X-RateLimit-Remaining', Math.max(limit - count, 0))

      if (count > limit) {
        res.setHeader('Retry-After', retryAfter)
        return res.status(429).json({
          error: `Too many attempts. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
        })
      }
      next()
    } catch {
      next() // never let the limiter take the API down
    }
  }
}

/** Clear a counter, e.g. after a successful login. */
async function reset(name, req, extra = '') {
  const key = `rl:${name}:${clientIp(req)}${extra ? ':' + extra : ''}`
  if (redis && redisReady) { try { await redis.del(key) } catch { /* ignore */ } }
  memory.delete(key)
}

const status = () => ({ redis: redisReady, store: redisReady ? 'redis' : 'memory' })

/** Read a limit from the environment so it can be tuned per deployment. */
const envLimit = (name, fallback) => {
  const v = Number(process.env[`RL_${name}`])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** Wipe every rate-limit counter. Used by the test suite between runs. */
async function clearAll() {
  memory.clear()
  if (redis && redisReady) {
    try {
      const keys = await redis.keys('rl:*')
      if (keys.length) await redis.del(...keys)
      return keys.length
    } catch { /* ignore */ }
  }
  return 0
}

module.exports = { rateLimit, reset, status, envLimit, clearAll }
