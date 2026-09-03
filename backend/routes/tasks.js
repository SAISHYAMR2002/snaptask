const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember, requireTaskAccess } = require('../lib/access')
const { notify, APP_URL } = require('../lib/notify')
const { text } = require('../lib/validate')

const router = express.Router()
router.use(auth)

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, avatar: true } },
  createdBy: { select: { id: true, name: true, avatar: true } },
  _count: { select: { comments: true } },
}

const linkTo = (t) => `${APP_URL}/workspace/${t.workspaceId}?task=${t.id}`

// POST /tasks
router.post('/', async (req, res) => {
  const { workspaceId, description, priority, dueDate, assignedToId, status } = req.body
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' })

  const t = text(req.body.title, { max: 200, field: 'Title', required: true })
  if (t.error) return res.status(400).json({ error: t.error })
  const d = text(description, { max: 5000, field: 'Description' })
  if (d.error) return res.status(400).json({ error: d.error })
  const title = t.value

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      status: status || 'todo',
      priority: priority || 'medium',
      dueDate: dueDate ? new Date(dueDate) : null,
      completedAt: status === 'done' ? new Date() : null,
      workspaceId,
      createdById: req.userId,
      assignedToId: assignedToId || null,
    },
    include: TASK_INCLUDE,
  })

  if (task.assignedToId) {
    await notify({
      userId: task.assignedToId,
      actorId: req.userId,
      type: 'assigned',
      title: `You were assigned "${task.title}"`,
      body: task.dueDate ? `Due ${new Date(task.dueDate).toDateString()}` : null,
      taskId: task.id,
      workspaceId,
      link: linkTo(task),
    })
  }

  res.status(201).json({ task })
})

// GET /tasks?workspaceId=...&q=&status=&priority=&assignee=
router.get('/', async (req, res) => {
  const { workspaceId, q, status, priority, assignee } = req.query
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId query param is required' })

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  const where = { workspaceId }
  if (q?.trim()) {
    where.OR = [
      { title: { contains: q.trim(), mode: 'insensitive' } },
      { description: { contains: q.trim(), mode: 'insensitive' } },
    ]
  }
  if (status) where.status = status
  if (priority) where.priority = priority
  if (assignee === 'unassigned') where.assignedToId = null
  else if (assignee) where.assignedToId = assignee

  const tasks = await prisma.task.findMany({
    where,
    include: TASK_INCLUDE,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ tasks })
})

// GET /tasks/assigned/me — every task assigned to me, across my workspaces
router.get('/assigned/me', async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { assignedToId: req.userId },
    include: { ...TASK_INCLUDE, workspace: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
  })
  res.json({ tasks })
})

// GET /tasks/activity/me — recent changes across my workspaces (dashboard feed)
router.get('/activity/me', async (req, res) => {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: req.userId },
    select: { workspaceId: true },
  })
  const ids = memberships.map((m) => m.workspaceId)

  const tasks = await prisma.task.findMany({
    where: { workspaceId: { in: ids } },
    include: { ...TASK_INCLUDE, workspace: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  })
  res.json({ tasks })
})

// GET /tasks/:id
router.get('/:id', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const task = await prisma.task.findUnique({ where: { id: result.task.id }, include: TASK_INCLUDE })
  res.json({ task })
})

// PATCH /tasks/:id
router.patch('/:id', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const before = result.task

  const { title, description, status, priority, dueDate, assignedToId } = req.body
  const data = {}
  if (title !== undefined) data.title = title
  if (description !== undefined) data.description = description
  if (priority !== undefined) data.priority = priority
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null
  if (assignedToId !== undefined) data.assignedToId = assignedToId || null
  if (status !== undefined) {
    data.status = status
    // stamp completion time so charts and analytics have real history
    if (status === 'done' && before.status !== 'done') data.completedAt = new Date()
    if (status !== 'done') data.completedAt = null
  }

  const task = await prisma.task.update({
    where: { id: before.id },
    data,
    include: TASK_INCLUDE,
  })

  // newly assigned to someone else -> tell them
  if (data.assignedToId && data.assignedToId !== before.assignedToId) {
    await notify({
      userId: data.assignedToId,
      actorId: req.userId,
      type: 'assigned',
      title: `You were assigned "${task.title}"`,
      taskId: task.id,
      workspaceId: task.workspaceId,
      link: linkTo(task),
    })
  }

  // status changed -> tell the assignee (if it wasn't them)
  if (data.status && data.status !== before.status && task.assignedToId) {
    await notify({
      userId: task.assignedToId,
      actorId: req.userId,
      type: 'status',
      title: `"${task.title}" moved to ${data.status.replace('-', ' ')}`,
      taskId: task.id,
      workspaceId: task.workspaceId,
      link: linkTo(task),
    })
  }

  res.json({ task })
})

// DELETE /tasks/:id
router.delete('/:id', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  await prisma.task.delete({ where: { id: result.task.id } })
  res.json({ ok: true })
})

/* ---------------- comments ---------------- */

// GET /tasks/:id/comments
router.get('/:id/comments', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const comments = await prisma.comment.findMany({
    where: { taskId: req.params.id },
    include: { user: { select: { id: true, name: true, avatar: true } } },
    orderBy: { createdAt: 'asc' },
  })
  res.json({ comments })
})

// POST /tasks/:id/comments  { content }
router.post('/:id/comments', async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' })

  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const task = result.task

  const comment = await prisma.comment.create({
    data: { content: content.trim(), taskId: task.id, userId: req.userId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  })

  // notify the assignee and the creator (notify() skips the actor itself)
  const recipients = new Set([task.assignedToId, task.createdById].filter(Boolean))
  for (const userId of recipients) {
    await notify({
      userId,
      actorId: req.userId,
      type: 'comment',
      title: `${comment.user.name} commented on "${task.title}"`,
      body: comment.content.slice(0, 140),
      taskId: task.id,
      workspaceId: task.workspaceId,
      link: linkTo(task),
    })
  }

  res.status(201).json({ comment })
})

module.exports = router
