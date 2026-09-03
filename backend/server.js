require('dotenv').config();

// Must come before every other require: Sentry instruments http, express and
// the database driver at require time, so anything loaded first is invisible
// to it.
const {
  initErrorReporting,
  captureError,
  installProcessHandlers,
  sentryExpressErrorHandler,
} = require('./lib/observability');
initErrorReporting();
installProcessHandlers();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { logger, requestLogger, routePath } = require('./lib/logger');
const { rateLimit, status: rateLimitStatus } = require('./lib/ratelimit');

const app = express();

// Security headers (nosniff, frameguard, HSTS, referrer policy, ...)
app.use(helmet());

// Allow the React dev server (Vite runs on port 5173) to call this API.
// X-Request-Id is exposed so a failing request can be traced in the logs.
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:5173',
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
}));

// Cap the body size — nothing here legitimately posts more than a few KB
app.use(express.json({ limit: '100kb' }));

// One structured line per request, with a request id echoed back to the caller
app.use(requestLogger);

// Broad safety net against runaway clients; the auth routes add tighter limits
app.use(rateLimit({ name: 'api', limit: 600, windowSec: 60 }));

// Health check - used to confirm the server is up
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running!', rateLimit: rateLimitStatus() });
});

// Feature routes
app.use('/auth', require('./routes/auth'));
app.use('/workspaces', require('./routes/workspaces'));
app.use('/tasks', require('./routes/tasks'));
app.use('/channels', require('./routes/channels'));
app.use('/notifications', require('./routes/notifications'));
app.use('/analytics', require('./routes/analytics'));
app.use('/settings', require('./routes/settings'));
app.use('/assistant', require('./routes/assistant'));
app.use('/search', require('./routes/search'));

// Unknown route -> JSON 404 rather than Express's HTML page
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// Sentry's handler goes before ours so it sees the error, then ours shapes the
// response. It is a no-op when Sentry is not configured.
sentryExpressErrorHandler(app);

// Anything that throws inside a route lands here. Express 5 automatically
// forwards errors from async handlers, so we don't need try/catch everywhere.
app.use((err, req, res, next) => {
  captureError(err, { reqId: req.id, method: req.method, path: routePath(req), userId: req.userId });

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request body is too large' });
  }

  const status = err.status || 500;
  // Never leak an internal message (or a stack) to the client on a 500 - the
  // request id is what connects the user's report to the real error in the log.
  const message = status >= 500 ? 'Something went wrong on our end' : err.message || 'Server error';
  res.status(status).json({ error: message, requestId: req.id });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`server listening on http://localhost:${PORT}`, {
    env: process.env.NODE_ENV || 'development',
  });
  // due-date reminders and overdue nudges
  require('./lib/reminders').startReminders();
});
