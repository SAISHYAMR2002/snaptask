const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();

// Every route in this file requires a logged-in user.
router.use(auth);

// POST /workspaces  { name }
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const workspace = await prisma.workspace.create({
    data: {
      name,
      ownerId: req.userId,
      members: { connect: { id: req.userId } }, // the creator is also a member
    },
  });

  res.status(201).json({ workspace });
});

// GET /workspaces  — the workspaces the current user belongs to
router.get('/', async (req, res) => {
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { id: req.userId } } },
    include: { _count: { select: { members: true, tasks: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ workspaces });
});

// GET /workspaces/:id  — one workspace with its members (must be a member)
router.get('/:id', async (req, res) => {
  const workspace = await prisma.workspace.findFirst({
    where: { id: req.params.id, members: { some: { id: req.userId } } },
    include: {
      members: { select: { id: true, name: true, email: true, avatar: true } },
    },
  });
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  res.json({ workspace });
});

// POST /workspaces/:id/members  { email }  — owner only
router.post('/:id/members', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const workspace = await prisma.workspace.findUnique({ where: { id: req.params.id } });
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  if (workspace.ownerId !== req.userId) {
    return res.status(403).json({ error: 'Only the workspace owner can add members' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'No user with that email' });

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { members: { connect: { id: user.id } } },
  });

  res.status(201).json({ ok: true });
});

module.exports = router;
