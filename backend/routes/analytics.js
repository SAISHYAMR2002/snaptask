const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')

const router = express.Router()
router.use(auth)

const DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => new Date(d.getTime() + n * DAY)

/**
 * GET /analytics/:workspaceId  — admins and the owner only.
 *
 * The "forecast" is a transparent heuristic, not machine learning:
 *   throughput = tasks that person completed in the last 14 days / 14
 *   a task is "at risk" if, working through their open tasks in due-date
 *   order at that throughput, it would land after its own due date.
 */
router.get('/:workspaceId', async (req, res) => {
  const check = await requireMember(req.params.workspaceId, req.userId, 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const workspaceId = req.params.workspaceId
  const now = new Date()
  const today = startOfDay(now)
  const windowStart = addDays(today, -13) // 14-day window

  const [members, tasks] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.task.findMany({ where: { workspaceId } }),
  ])

  const open = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')
  const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < today)

  const doneInWindow = done.filter((t) => t.completedAt && new Date(t.completedAt) >= windowStart)
  const teamThroughput = doneInWindow.length / 14

  // on-time = completed on or before its due date (tasks with no due date count as on time)
  const withDue = done.filter((t) => t.dueDate && t.completedAt)
  const onTime = withDue.filter((t) => new Date(t.completedAt) <= new Date(t.dueDate))
  const onTimeRate = withDue.length ? Math.round((onTime.length / withDue.length) * 100) : 100

  /* ---------- per member ---------- */
  const memberStats = members.map((m) => {
    const mine = tasks.filter((t) => t.assignedToId === m.userId)
    const myOpen = mine.filter((t) => t.status !== 'done')
    const myDone = mine.filter((t) => t.status === 'done')
    const myOverdue = myOpen.filter((t) => t.dueDate && new Date(t.dueDate) < today)

    const myRecentDone = myDone.filter((t) => t.completedAt && new Date(t.completedAt) >= windowStart)
    const throughput = myRecentDone.length / 14 // tasks per day
    const rate = throughput > 0 ? throughput : 0.15 // assume a slow-but-nonzero pace

    // walk their open tasks in due order and see which would land late
    const queue = [...myOpen].sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate) - new Date(b.dueDate)
    })
    let atRisk = 0
    queue.forEach((t, i) => {
      if (!t.dueDate) return
      const projectedFinish = addDays(today, (i + 1) / rate)
      if (projectedFinish > new Date(t.dueDate)) atRisk++
    })

    const completionRate = mine.length ? Math.round((myDone.length / mine.length) * 100) : 0

    let status = 'on-track'
    if (myOverdue.length >= 2 || atRisk >= 3) status = 'behind'
    else if (myOverdue.length >= 1 || atRisk >= 1) status = 'at-risk'

    let forecast = 'On time'
    if (status === 'on-track' && completionRate >= 80) forecast = 'Ahead of pace'
    if (atRisk === 1) forecast = '~1 deadline at risk'
    if (atRisk > 1) forecast = `~${atRisk} deadlines at risk`
    if (myOverdue.length && !atRisk) forecast = `${myOverdue.length} overdue`

    return {
      id: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      open: myOpen.length,
      overdue: myOverdue.length,
      doneRecent: myRecentDone.length,
      completionRate,
      atRisk,
      status,
      forecast,
    }
  })

  /* ---------- team burndown + projection ----------
     The window starts at the workspace's first task, not a fixed 14 days back,
     otherwise a new workspace draws a misleading flat line at zero. */
  const firstTaskAt = tasks.length
    ? startOfDay(new Date(Math.min(...tasks.map((t) => new Date(t.createdAt)))))
    : today
  const chartStart = firstTaskAt > windowStart ? firstTaskAt : windowStart
  const spanDays = Math.max(Math.round((today - chartStart) / DAY) + 1, 2)

  const burndown = []
  for (let i = 0; i < spanDays; i++) {
    const day = addDays(chartStart, i)
    const dayEnd = addDays(day, 1)
    const created = tasks.filter((t) => new Date(t.createdAt) < dayEnd).length
    const closed = tasks.filter((t) => t.completedAt && new Date(t.completedAt) < dayEnd).length
    burndown.push({
      date: day.toISOString().slice(0, 10),
      remaining: Math.max(created - closed, 0),
      ideal: null, // filled in below
    })
  }
  const peak = Math.max(...burndown.map((p) => p.remaining), 0)
  burndown.forEach((p, i) => {
    p.ideal = Math.max(Math.round((peak * (spanDays - 1 - i)) / (spanDays - 1)), 0)
  })
  const youngWorkspace = spanDays < 4

  // how many days to clear what's left, at the current team pace
  const daysToClear = teamThroughput > 0 ? open.length / teamThroughput : null
  const daysLate = daysToClear === null ? null : Math.max(Math.round(daysToClear - 3), 0)

  /* ---------- completions per day, last 7 days ---------- */
  const weekly = []
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i)
    const dayEnd = addDays(day, 1)
    weekly.push({
      date: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString('en-US', { weekday: 'short' }),
      count: done.filter(
        (t) => t.completedAt && new Date(t.completedAt) >= day && new Date(t.completedAt) < dayEnd,
      ).length,
    })
  }

  res.json({
    kpis: {
      throughput: Number(teamThroughput.toFixed(1)),
      onTimeRate,
      atRiskMembers: memberStats.filter((m) => m.status !== 'on-track').length,
      totalMembers: memberStats.length,
      overdueTasks: overdue.length,
      openTasks: open.length,
      doneTasks: done.length,
    },
    forecast: {
      daysToClear: daysToClear === null ? null : Math.round(daysToClear),
      daysLate,
      youngWorkspace,
      message:
        daysToClear === null
          ? 'Not enough completed work yet to forecast'
          : youngWorkspace
            ? 'Building history — the forecast gets accurate after a few days of activity'
            : daysLate > 0
              ? `At the current pace this finishes ~${daysLate} day${daysLate === 1 ? '' : 's'} late`
              : 'On pace to finish on time',
    },
    burndown,
    weekly,
    members: memberStats,
  })
})

module.exports = router
