const { randomUUID } = require('node:crypto')

/**
 * Structured logging.
 *
 * In production every line is one JSON object, because that is what log
 * aggregators (Render, CloudWatch, Loki, Datadog) can actually query - you can
 * ask "show me every 500 on /tasks for user X" instead of grepping prose. In
 * development that is unreadable, so the same records are printed as a compact
 * coloured line instead. Same call sites, two renderings.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN = LEVELS[process.env.LOG_LEVEL] || (process.env.NODE_ENV === 'test' ? LEVELS.warn : LEVELS.info)
const PRETTY = process.env.NODE_ENV !== 'production' && process.env.LOG_FORMAT !== 'json'

const COLOR = { debug: '\x1b[2m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' }
const RESET = '\x1b[0m'

/**
 * Keys whose values must never reach a log line, at any depth.
 *
 * This is the whole reason to have a logger rather than console.log: logging a
 * request body is a normal debugging instinct, and on a signup route that body
 * contains a plaintext password. Redaction has to be automatic, because the
 * moment it depends on remembering, it will eventually not happen.
 */
const SECRET_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'token', 'accesstoken', 'refreshtoken',
  'authorization', 'cookie', 'jwt', 'secret', 'apikey', 'api_key', 'resend_api_key',
  'jwt_secret', 'database_url', 'redis_url',
])

function redact(value, depth = 0) {
  if (depth > 6 || value == null) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()

  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1)
  }
  return out
}

function emit(level, msg, fields) {
  if (LEVELS[level] < MIN) return

  const record = { level, time: new Date().toISOString(), msg, ...redact(fields || {}) }

  if (!PRETTY) {
    // one JSON object per line - never multi-line, or the aggregator splits it
    console[level === 'debug' ? 'log' : level](JSON.stringify(record))
    return
  }

  const { level: _l, time, msg: _m, ...rest } = record
  const extras = Object.entries(rest)
    // JSON.stringify drops undefined for us; the pretty path has to do it itself
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ')
  const stamp = time.slice(11, 19)
  console[level === 'debug' ? 'log' : level](
    `${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET} \x1b[2m${stamp}${RESET} ${msg}${extras ? ' \x1b[2m' + extras + RESET : ''}`,
  )
}

/** A logger carrying fixed fields (a request id, a user id) on every line. */
function child(base = {}) {
  const bind = (level) => (msg, fields) => emit(level, msg, { ...base, ...fields })
  return {
    debug: bind('debug'),
    info: bind('info'),
    warn: bind('warn'),
    error: bind('error'),
    child: (more) => child({ ...base, ...more }),
  }
}

const logger = child()

/**
 * The full path, including the router's mount point.
 *
 * `req.path` inside a mounted router is relative to that mount, so a login
 * logs as "/login" and is indistinguishable from any other router's /login.
 * `req.originalUrl` keeps the prefix — but it also carries the query string,
 * and this app puts single-use verification and password-reset tokens there.
 * Dropping the query is not tidiness; it is the difference between a log file
 * you can share and one that hands over working account-recovery links.
 */
const routePath = (req) => (req.originalUrl || req.url || '').split('?')[0] || '/'

/**
 * Request logging. One line per request, after it completes, carrying the
 * status and how long it took.
 *
 * The request id is echoed back in a header so a user can quote the id from a
 * failing request and it can be found in the logs immediately - far better
 * than "it broke around 3pm".
 */
function requestLogger(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID()
  const started = process.hrtime.bigint()

  req.id = id
  req.log = logger.child({ reqId: id })
  res.setHeader('X-Request-Id', id)

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    // 5xx is ours, 4xx is usually the caller's; noise level should differ
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    emit(level, `${req.method} ${routePath(req)}`, {
      reqId: id,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      userId: req.userId || undefined,
      ip: req.ip,
    })
  })

  next()
}

module.exports = { logger, requestLogger, redact, child, routePath }
