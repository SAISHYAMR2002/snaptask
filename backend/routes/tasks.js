const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// True if the user belongs to the workspace. Used to guard every task route
// so people can only touch tasks in workspaces they're a member of.
async function isMember(workspaceId, userId) {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, members: { some: { id: userId } } },
    select: { id: true },
  });
  return Boolean(ws);
}

// The related data we always send back with a task.
const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, avatar: true } },
  createdBy: { select: { id: true, name: true, avatar: true } },
};

// Load a task and check the caller is allowed to see it.
// Returns { task } on success, or { status, error } to send back.
async function loadTaskForUser(taskId, userId) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { status: 404, error: 'Task not found' };
  if (!(await isMember(task.workspaceId, userId))) {
    return { status: 403, error: 'Not allowed' };
  }
  return { task };
}

// POST /tasks  { workspaceId, title, description?, priority?, dueDate?, assignedToId? }
router.post('/', async (req, res) => {
  const { workspaceId, title, description, priority, dueDate, assignedToId } = req.body;

  if (!workspaceId || !title) {
    return res.status(400).json({ error: 'workspaceId and title are required' });
  }
  if (!(await isMember(workspaceId, req.userId))) {
    return res.status(403).json({ error: 'You are not a member of that workspace' });
  }

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      priority: priority || 'medium',
      dueDate: dueDate ? new Date(dueDate) : null,
      workspaceId,
      createdById: req.userId,
      assignedToId: assignedToId || null,
    },
    include: TASK_INCLUDE,
  });

  res.status(201).json({ task });
});

// GET /tasks?workspaceId=...  — all tasks in a workspace
router.get('/', async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId query param is required' });
  }
  if (!(await isMember(workspaceId, req.userId))) {
    return res.status(403).json({ error: 'You are not a member of that workspace' });
  }

  const tasks = await prisma.task.findMany({
    where: { workspaceId },
    include: TASK_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ tasks });
});

// GET /tasks/assigned/me  — every task assigned to me, across all my workspaces
// (powers the personal dashboard). Must be declared before "/:id".
router.get('/assigned/me', async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: {
      assignedToId: req.userId,
      workspace: { members: { some: { id: req.userId } } },
    },
    include: { ...TASK_INCLUDE, workspace: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ tasks });
});

// GET /tasks/:id
router.get('/:id', async (req, res) => {
  const result = await loadTaskForUser(req.params.id, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const task = await prisma.task.findUnique({
    where: { id: result.task.id },
    include: TASK_INCLUDE,
  });
  res.json({ task });
});

// PATCH /tasks/:id  — update any subset of fields (this is how "move to In Progress" works)
router.patch('/:id', async (req, res) => {
  const result = await loadTaskForUser(req.params.id, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const { title, description, status, priority, dueDate, assignedToId } = req.body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (status !== undefined) data.status = status;
  if (priority !== undefined) data.priority = priority;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (assignedToId !== undefined) data.assignedToId = assignedToId || null;

  const task = await prisma.task.update({
    where: { id: result.task.id },
    data,
    include: TASK_INCLUDE,
  });
  res.json({ task });
});

// DELETE /tasks/:id
router.delete('/:id', async (req, res) => {
  const result = await loadTaskForUser(req.params.id, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await prisma.task.delete({ where: { id: result.task.id } });
  res.json({ ok: true });
});

module.exports = router;
