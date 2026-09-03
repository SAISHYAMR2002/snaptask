const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { rateLimit, status: rateLimitStatus } = require('./lib/ratelimit');

const app = express();

// Security headers (nosniff, frameguard, HSTS, referrer policy, ...)
app.use(helmet());

// Allow the React dev server (Vite runs on port 5173) to call this API
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:5173', credentials: true }));

// Cap the body size — nothing here legitimately posts more than a few KB
app.use(express.json({ limit: '100kb' }));

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

// Unknown route -> JSON 404 rather than Express's HTML page
app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// Anything that throws inside a route lands here. Express 5 automatically
// forwards errors from async handlers, so we don't need try/catch everywhere.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request body is too large' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // due-date reminders and overdue nudges
  require('./lib/reminders').startReminders();
});
