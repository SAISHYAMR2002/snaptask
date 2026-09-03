const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember, requireTaskAccess } = require('../lib/access')
const { notify, APP_URL } = require('../lib/notify')
const { text } = require('../lib/validate')
const { record, diffTask, describe, taskMetrics } = require('../lib/history')

const router = express.Router()
router.use(auth)

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, avatar: true } },
  createdBy: { select: { id: true, name: true, avatar: true } },
  labels: { select: { id: true, name: true, color: true } },
  subtasks: { orderBy: { position: 'asc' } },
  _count: { select: { comments: true, subtasks: true } },
}

const linkTo = (t) => `${APP_URL}/workspace/${t.workspaceId}?task=${t.id}`

/** The workspace's own columns, so "done" is whatever that team calls it. */
async function statusesFor(workspaceId) {
  const rows = await prisma.workspaceStatus.findMany({
    where: { workspaceId },
    orderBy: { position: 'asc' },
  })
  return {
    all: rows,
    isDone: (key) => rows.find((s) => s.key === key)?.isDone === true,
    isFirst: (key) => rows[0]?.key === key,
    valid: (key) => rows.some((s) => s.key === key),
  }
}

/** Timestamps that must follow from a status change. */
function timestampsFor(task, nextStatus, st) {
  const data = {}
  const wasDone = st.isDone(task.status)
  const nowDone = st.isDone(nextStatus)

  if (nowDone && !wasDone) data.completedAt = new Date()
  if (!nowDone && wasDone) data.completedAt = null
  // first move off the first column is when work actually began
  if (!task.startedAt && !st.isFirst(nextStatus)) data.startedAt = new Date()
  return data
}

/* ------------------------------- create ------------------------------- */

router.post('/', async (req, res) => {
  const { workspaceId, description, priority, dueDate, assignedToId, status, estimateHours, labelIds, sprintId } = req.body
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' })

  const t = text(req.body.title, { max: 200, field: 'Title', required: true })
  if (t.error) return res.status(400).json({ error: t.error })
  const d = text(description, { max: 5000, field: 'Description' })
  if (d.error) return res.status(400).json({ error: d.error })

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  const st = await statusesFor(workspaceId)
  const useStatus = status && st.valid(status) ? status : st.all[0]?.key || 'todo'

  const task = await prisma.task.create({
    data: {
      title: t.value,
      description: d.value,
      status: useStatus,
      priority: priority || 'medium',
      estimateHours: Number.isFinite(Number(estimateHours)) && estimateHours !== null ? Number(estimateHours) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      completedAt: st.isDone(useStatus) ? new Date() : null,
      workspaceId,
      createdById: req.userId,
      assignedToId: assignedToId || null,
      sprintId: sprintId || null,
      ...(labelIds?.length ? { labels: { connect: labelIds.map((id) => ({ id })) } } : {}),
    },
    include: TASK_INCLUDE,
  })

  await record(task.id, req.userId, { type: 'created' })

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

/* -------------------------------- read -------------------------------- */

router.get('/', async (req, res) => {
  const { workspaceId, q, status, priority, assignee, label, sprintId } = req.query
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
  if (sprintId) where.sprintId = sprintId
  if (label) where.labels = { some: { id: label } }
  if (assignee === 'unassigned') where.assignedToId = null
  else if (assignee) where.assignedToId = assignee

  const tasks = await prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: { createdAt: 'desc' } })
  res.json({ tasks })
})

router.get('/assigned/me', async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { assignedToId: req.userId },
    include: { ...TASK_INCLUDE, workspace: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
  })
  res.json({ tasks })
})

router.get('/activity/me', async (req, res) => {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: req.userId },
    select: { workspaceId: true },
  })
  const tasks = await prisma.task.findMany({
    where: { workspaceId: { in: memberships.map((m) => m.workspaceId) } },
    include: { ...TASK_INCLUDE, workspace: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  })
  res.json({ tasks })
})

router.get('/:id', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const task = await prisma.task.findUnique({ where: { id: result.task.id }, include: TASK_INCLUDE })
  res.json({ task })
})

// GET /tasks/:id/activity — the history feed for one task
router.get('/:id/activity', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const events = await prisma.taskEvent.findMany({
    where: { taskId: req.params.id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  res.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor?.name || 'SnapTask',
      text: describe(e),
      createdAt: e.createdAt,
    })),
    metrics: taskMetrics(result.task, events),
  })
})

/* ------------------------------- update ------------------------------- */

router.patch('/:id', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const before = result.task

  const { title, description, status, priority, dueDate, assignedToId, estimateHours, labelIds, sprintId } = req.body
  const st = await statusesFor(before.workspaceId)

  const data = {}
  if (title !== undefined) data.title = title
  if (description !== undefined) data.description = description
  if (priority !== undefined) data.priority = priority
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null
  if (assignedToId !== undefined) data.assignedToId = assignedToId || null
  if (sprintId !== undefined) data.sprintId = sprintId || null
  if (estimateHours !== undefined) {
    data.estimateHours = estimateHours === null || estimateHours === '' ? null : Number(estimateHours)
  }
  if (status !== undefined) {
    if (!st.valid(status)) return res.status(400).json({ error: 'That status does not exist in this workspace' })
    data.status = status
    Object.assign(data, timestampsFor(before, status, st))
  }
  if (labelIds !== undefined) data.labels = { set: labelIds.map((id) => ({ id })) }

  const task = await prisma.task.update({ where: { id: before.id }, data, include: TASK_INCLUDE })

  // history — resolve ids to names so the feed reads properly
  const names = {}
  for (const id of [before.assignedToId, task.assignedToId].filter(Boolean)) {
    const u = await prisma.user.findUnique({ where: { id }, select: { name: true } })
    if (u) names[id] = u.name
  }
  await record(task.id, req.userId, diffTask(before, task, names))

  if (data.assignedToId && data.assignedToId !== before.assignedToId) {
    await notify({
      userId: data.assignedToId, actorId: req.userId, type: 'assigned',
      title: `You were assigned "${task.title}"`, taskId: task.id,
      workspaceId: task.workspaceId, link: linkTo(task),
    })
  }
  if (data.status && data.status !== before.status && task.assignedToId) {
    await notify({
      userId: task.assignedToId, actorId: req.userId, type: 'status',
      title: `"${task.title}" moved to ${data.status.replace('-', ' ')}`,
      taskId: task.id, workspaceId: task.workspaceId, link: linkTo(task),
    })
  }

  res.json({ task })
})

/* ------------------------------- bulk --------------------------------- */

// POST /tasks/bulk  { ids[], action, value? }
// Returns `undo` describing how to put things back.
router.post('/bulk', async (req, res) => {
  const { ids, action, value } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids is required' })
  if (ids.length > 100) return res.status(400).json({ error: 'Too many tasks at once (max 100)' })

  const tasks = await prisma.task.findMany({ where: { id: { in: ids } } })
  if (!tasks.length) return res.status(404).json({ error: 'No matching tasks' })

  // every task must be in one workspace the caller belongs to
  const workspaceIds = [...new Set(tasks.map((t) => t.workspaceId))]
  if (workspaceIds.length > 1) return res.status(400).json({ error: 'Tasks span multiple workspaces' })
  const check = await requireMember(workspaceIds[0], req.userId)
  if (check.error) return res.status(403).json({ error: 'Not allowed' })

  const st = await statusesFor(workspaceIds[0])
  // snapshot for undo, before anything changes
  const undo = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    priority: t.priority,
    assignedToId: t.assignedToId,
    dueDate: t.dueDate,
    deleted: action === 'delete',
    data: action === 'delete' ? t : undefined,
  }))

  if (action === 'delete') {
    await prisma.task.deleteMany({ where: { id: { in: ids } } })
    return res.json({ ok: true, affected: ids.length, undo, action })
  }

  const patch = {}
  if (action === 'status') {
    if (!st.valid(value)) return res.status(400).json({ error: 'Unknown status' })
    patch.status = value
  } else if (action === 'priority') patch.priority = value
  else if (action === 'assign') patch.assignedToId = value || null
  else if (action === 'due') patch.dueDate = value ? new Date(value) : null
  else return res.status(400).json({ error: 'Unknown bulk action' })

  // status needs per-task timestamps, so those go one at a time
  if (action === 'status') {
    for (const t of tasks) {
      await prisma.task.update({ where: { id: t.id }, data: { ...patch, ...timestampsFor(t, value, st) } })
    }
  } else {
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: patch })
  }

  for (const t of tasks) {
    await record(t.id, req.userId, { type: action === 'assign' ? 'assignee' : action, oldValue: t[action === 'assign' ? 'assignedToId' : action], newValue: value })
  }

  res.json({ ok: true, affected: tasks.length, undo, action })
})

// POST /tasks/bulk/undo  { undo[] }
router.post('/bulk/undo', async (req, res) => {
  const { undo } = req.body
  if (!Array.isArray(undo) || !undo.length) return res.status(400).json({ error: 'undo payload is required' })

  let restored = 0
  for (const u of undo) {
    if (u.deleted && u.data) {
      const { id, ...rest } = u.data
      const exists = await prisma.task.findUnique({ where: { id } })
      if (exists) continue
      const check = await requireMember(rest.workspaceId, req.userId)
      if (check.error) continue
      await prisma.task.create({ data: { id, ...rest } })
      restored++
    } else {
      const task = await prisma.task.findUnique({ where: { id: u.id } })
      if (!task) continue
      const check = await requireMember(task.workspaceId, req.userId)
      if (check.error) continue
      await prisma.task.update({
        where: { id: u.id },
        data: {
          status: u.status,
          priority: u.priority,
          assignedToId: u.assignedToId,
          dueDate: u.dueDate ? new Date(u.dueDate) : null,
        },
      })
      restored++
    }
  }
  res.json({ ok: true, restored })
})

router.delete('/:id', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  await prisma.task.delete({ where: { id: result.task.id } })
  res.json({ ok: true })
})

/* ------------------------------ subtasks ------------------------------ */

router.post('/:id/subtasks', async (req, res) => {
  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const t = text(req.body.title, { max: 200, field: 'Title', required: true })
  if (t.error) return res.status(400).json({ error: t.error })

  const count = await prisma.subtask.count({ where: { taskId: req.params.id } })
  const subtask = await prisma.subtask.create({
    data: { taskId: req.params.id, title: t.value, position: count },
  })
  await record(req.params.id, req.userId, { type: 'subtask', newValue: `added "${t.value}"` })
  res.status(201).json({ subtask })
})

router.patch('/subtasks/:subtaskId', async (req, res) => {
  const subtask = await prisma.subtask.findUnique({ where: { id: req.params.subtaskId } })
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' })
  const result = await requireTaskAccess(subtask.taskId, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const data = {}
  if (typeof req.body.done === 'boolean') data.done = req.body.done
  if (req.body.title !== undefined) {
    const t = text(req.body.title, { max: 200, field: 'Title', required: true })
    if (t.error) return res.status(400).json({ error: t.error })
    data.title = t.value
  }
  const updated = await prisma.subtask.update({ where: { id: subtask.id }, data })
  res.json({ subtask: updated })
})

router.delete('/subtasks/:subtaskId', async (req, res) => {
  const subtask = await prisma.subtask.findUnique({ where: { id: req.params.subtaskId } })
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' })
  const result = await requireTaskAccess(subtask.taskId, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  await prisma.subtask.delete({ where: { id: subtask.id } })
  res.json({ ok: true })
})

/* ------------------------------ comments ------------------------------ */

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

router.post('/:id/comments', async (req, res) => {
  const c = text(req.body.content, { max: 5000, field: 'Comment', required: true })
  if (c.error) return res.status(400).json({ error: c.error })

  const result = await requireTaskAccess(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const task = result.task

  const comment = await prisma.comment.create({
    data: { content: c.value, taskId: task.id, userId: req.userId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  })

  for (const userId of new Set([task.assignedToId, task.createdById].filter(Boolean))) {
    await notify({
      userId, actorId: req.userId, type: 'comment',
      title: `${comment.user.name} commented on "${task.title}"`,
      body: comment.content.slice(0, 140),
      taskId: task.id, workspaceId: task.workspaceId, link: linkTo(task),
    })
  }

  res.status(201).json({ comment })
})

module.exports = router
