const { logger } = require('./logger')

/**
 * Error reporting.
 *
 * Sentry is entirely opt-in: with no SENTRY_DSN set nothing initialises, no
 * network calls are made and nothing is billed. That matters here because the
 * app has to stay free to run - so this is wiring that costs nothing until
 * someone actually wants it, not a dependency that phones home by default.
 *
 * IMPORTANT: this module must be required before anything else in server.js.
 * Sentry patches http, express and the database driver at require time, so
 * modules loaded before it are never instrumented.
 */

let Sentry = null

function initErrorReporting() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    logger.info('error reporting disabled (no SENTRY_DSN)')
    return null
  }

  Sentry = require('@sentry/node')
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || undefined,

    // A free plan has a monthly event quota, so a crash loop must not burn it
    // in an afternoon. 10% of traces is plenty to spot a slow endpoint.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0.1),

    // Last line of defence. The logger redacts what we log; this redacts what
    // Sentry collects on its own - headers, cookies, request bodies.
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        if (event.request.headers) {
          delete event.request.headers.authorization
          delete event.request.headers.cookie
        }
        if (event.request.data && typeof event.request.data === 'object') {
          for (const k of Object.keys(event.request.data)) {
            if (/password|token|secret/i.test(k)) event.request.data[k] = '[redacted]'
          }
        }
      }
      return event
    },
  })

  logger.info('error reporting enabled', { environment: process.env.NODE_ENV || 'development' })
  return Sentry
}

/** Report an error, whether or not Sentry is configured. Never throws. */
function captureError(err, context = {}) {
  try {
    logger.error(err?.message || 'unhandled error', {
      ...context,
      stack: err?.stack?.split('\n').slice(0, 4).join(' | '),
    })
    if (Sentry) Sentry.captureException(err, { extra: context })
  } catch {
    // reporting an error must never be the thing that takes the process down
  }
}

/**
 * Crashes that escape Express. Without these the process dies silently and
 * the only evidence is the platform restarting it.
 */
function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    captureError(reason instanceof Error ? reason : new Error(String(reason)), { kind: 'unhandledRejection' })
  })
  process.on('uncaughtException', (err) => {
    captureError(err, { kind: 'uncaughtException' })
    // The process is in an unknown state now. Give Sentry a moment to flush,
    // then exit and let the platform restart us clean.
    setTimeout(() => process.exit(1), 1500).unref()
  })
}

const sentryExpressErrorHandler = (app) => {
  if (Sentry) Sentry.setupExpressErrorHandler(app)
}

module.exports = { initErrorReporting, captureError, installProcessHandlers, sentryExpressErrorHandler }
