const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();

// Shape a user row for sending to the client — never include the password hash.
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatar: u.avatar,
  createdAt: u.createdAt,
});

// Create a signed token that proves "this is user <id>" for the next 7 days.
function makeToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /auth/signup  { name, email, password }
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  // Never store the raw password. bcrypt turns it into a one-way hash.
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: passwordHash },
  });

  res.status(201).json({ user: publicUser(user), token: makeToken(user.id) });
});

// POST /auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Same generic message whether the email or the password is wrong,
  // so an attacker can't tell which emails have accounts.
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const passwordOk = await bcrypt.compare(password, user.password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({ user: publicUser(user), token: makeToken(user.id) });
});

// GET /auth/me  — returns the logged-in user (used by the frontend on load)
router.get('/me', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
