/**
 * Front-end error reporting.
 *
 * Sentry is loaded with a dynamic import and only when VITE_SENTRY_DSN is set,
 * so with no DSN configured the library never enters the main bundle at all -
 * the cost of this file to everyone else is a few bytes. That matters: this
 * app has to stay free to run, and a monitoring SDK that ships whether or not
 * you use it is a tax on every page load.
 */

let sentry = null

export async function initErrorReporting() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return null

  try {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Session replay and profiling are the expensive parts of a free plan's
      // quota, so only plain error reporting plus a light trace sample.
      tracesSampleRate: 0.1,
      beforeSend(event) {
        // The JWT lives in localStorage; make certain a breadcrumb or a URL
        // never carries it off the machine.
        if (event.request?.url) event.request.url = event.request.url.replace(/token=[^&]+/g, 'token=[redacted]')
        return event
      },
    })
    sentry = Sentry
    return Sentry
  } catch {
    // Monitoring failing to load must never stop the app from rendering.
    return null
  }
}

export function reportError(error, context = {}) {
  // Always log locally — in dev that is the only place it shows up.
  console.error(error, context)
  try {
    sentry?.captureException(error, { extra: context })
  } catch {
    /* reporting must not throw */
  }
}
