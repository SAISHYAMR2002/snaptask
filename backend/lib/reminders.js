const prisma = require('./prisma')
const { notify, APP_URL } = require('./notify')
const { logger } = require('./logger')

const HOUR = 3600000

/**
 * Background reminders. Runs every 30 minutes (and once shortly after boot).
 *  - "due soon"  : a task assigned to you is due within your remindHours window
 *  - "overdue"   : a task assigned to you is past its due date
 * Each task only produces one reminder of each kind per 20 hours, so a long
 * running server doesn't spam the same person every cycle.
 */
async function runReminderSweep() {
  const now = new Date()
  const since = new Date(now.getTime() - 20 * HOUR)

  // "Not done" is per-workspace since board columns became customisable: a team
  // whose finished column is called "Shipped" has no task with status 'done',
  // so the old `status: { not: 'done' }` filter treated every completed task as
  // open and nagged people about work they had already finished.
  const doneStatuses = await prisma.workspaceStatus.findMany({
    where: { isDone: true },
    select: { workspaceId: true, key: true },
  })
  const doneByWorkspace = new Map()
  for (const s of doneStatuses) {
    if (!doneByWorkspace.has(s.workspaceId)) doneByWorkspace.set(s.workspaceId, new Set())
    doneByWorkspace.get(s.workspaceId).add(s.key)
  }

  const candidates = await prisma.task.findMany({
    where: { completedAt: null, dueDate: { not: null }, assignedToId: { not: null } },
    select: { id: true, title: true, dueDate: true, assignedToId: true, workspaceId: true, status: true },
  })
  // completedAt is the primary signal; the status check catches rows whose
  // column was flagged done after the fact.
  const openTasks = candidates.filter(
    (t) => !(doneByWorkspace.get(t.workspaceId)?.has(t.status) ?? t.status === 'done'),
  )
  // No open tasks still has to fall through: private reminders are independent
  // of tasks, and an early return here would silently never deliver them.
  if (!openTasks.length) {
    return { dueSent: 0, overdueSent: 0, privateSent: await sweepPrivateReminders(now) }
  }

  // Load preferences and recently-sent reminders in two queries rather than
  // two per task — this loop used to be O(2n) round trips to the database.
  const userIds = [...new Set(openTasks.map((t) => t.assignedToId))]
  const [prefsRows, recent] = await Promise.all([
    prisma.notificationPrefs.findMany({ where: { userId: { in: userIds } } }),
    prisma.notification.findMany({
      where: {
        userId: { in: userIds },
        type: { in: ['due', 'overdue'] },
        createdAt: { gte: since },
        taskId: { in: openTasks.map((t) => t.id) },
      },
      select: { userId: true, taskId: true, type: true },
    }),
  ])
  const prefsBy = new Map(prefsRows.map((p) => [p.userId, p]))
  const alreadySent = new Set(recent.map((n) => `${n.userId}|${n.taskId}|${n.type}`))

  let dueSent = 0
  let overdueSent = 0

  for (const task of openTasks) {
    const prefs = prefsBy.get(task.assignedToId)
    if (!prefs) continue

    const due = new Date(task.dueDate)
    const isOverdue = due < now
    const type = isOverdue ? 'overdue' : 'due'

    if (isOverdue && !prefs.nudgeOverdue) continue
    if (!isOverdue && !prefs.remindBeforeDue) continue
    if (!isOverdue && due.getTime() - now.getTime() > prefs.remindHours * HOUR) continue

    if (alreadySent.has(`${task.assignedToId}|${task.id}|${type}`)) continue

    await notify({
      userId: task.assignedToId,
      type,
      title: isOverdue
        ? `"${task.title}" is overdue`
        : `"${task.title}" is due ${due.toDateString()}`,
      body: isOverdue ? 'It is past its due date and still open.' : 'Coming up soon.',
      taskId: task.id,
      workspaceId: task.workspaceId,
      link: `${APP_URL}/workspace/${task.workspaceId}?task=${task.id}`,
    })

    if (isOverdue) overdueSent++
    else dueSent++
  }

  const privateSent = await sweepPrivateReminders(now)
  return { dueSent, overdueSent, privateSent }
}

/**
 * Private note reminders.
 *
 * Delivered to the note's AUTHOR and nobody else — not the subject, not admins.
 * `remindedAt` is stamped so a reminder fires once; moving the date clears it
 * (see routes/notes.js) so a rescheduled reminder fires again.
 */
async function sweepPrivateReminders(now) {
  const due = await prisma.privateNote.findMany({
    where: { remindAt: { not: null, lte: now }, remindedAt: null },
    select: {
      id: true, body: true, authorId: true, workspaceId: true,
      subject: { select: { name: true } },
    },
    take: 200,
  })
  if (!due.length) return 0

  for (const note of due) {
    await notify({
      userId: note.authorId,
      type: 'note',
      title: note.subject ? `Private reminder about ${note.subject.name}` : 'Private reminder',
      body: note.body.slice(0, 140),
      workspaceId: note.workspaceId,
      link: `${APP_URL}/workspace/${note.workspaceId}/notes`,
    })
  }

  await prisma.privateNote.updateMany({
    where: { id: { in: due.map((n) => n.id) } },
    data: { remindedAt: now },
  })
  return due.length
}

function startReminders() {
  const tick = async () => {
    try {
      const r = await runReminderSweep()
      if (r.dueSent || r.overdueSent || r.privateSent) {
        logger.info('reminder sweep', { component: 'reminders', due: r.dueSent, overdue: r.overdueSent, private: r.privateSent })
      }
    } catch (err) {
      logger.error('reminder sweep failed', { component: 'reminders', err: err.message })
    }
  }
  setTimeout(tick, 10000) // once shortly after boot
  setInterval(tick, 30 * 60 * 1000) // then every 30 minutes
}

module.exports = { startReminders, runReminderSweep, sweepPrivateReminders }
