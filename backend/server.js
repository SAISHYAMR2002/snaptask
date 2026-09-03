const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Allow the React dev server (Vite runs on port 5173) to call this API
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Health check - used to confirm the server is up
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running!' });
});

// Feature routes
app.use('/auth', require('./routes/auth'));
app.use('/workspaces', require('./routes/workspaces'));
app.use('/tasks', require('./routes/tasks'));

// Anything that throws inside a route lands here. Express 5 automatically
// forwards errors from async handlers, so we don't need try/catch everywhere.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
