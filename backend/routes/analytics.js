const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')
const { taskMetrics } = require('../lib/history')

const router = express.Router()
router.use(auth)

const DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const endOfDay = (d) => new Date(startOfDay(d).getTime() + DAY - 1)
const addDays = (d, n) => new Date(d.getTime() + n * DAY)
// Format the LOCAL calendar date. toISOString() would convert back to UTC and
// shift the day backwards for anyone east of Greenwich, so "2026-01-01" came
// out as "2025-12-31" in IST.
const iso = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const round = (n, p = 1) => (n == null ? null : Number(n.toFixed(p)))

/**
 * Resolve the reporting window from the query.
 *   ?sprintId=..            -> that sprint's dates
 *   ?from=&to=              -> an explicit range (any length, past or future)
 *   ?preset=7d|30d|90d|1y   -> a rolling window
 * Defaults to the last 14 days.
 */
async function resolveRange(query, workspaceId) {
  const today = startOfDay(new Date())

  if (query.sprintId) {
    const sprint = await prisma.sprint.findFirst({ where: { id: query.sprintId, workspaceId } })
    if (sprint) {
      return { from: startOfDay(new Date(sprint.startsAt)), to: endOfDay(new Date(sprint.endsAt)), label: sprint.name, sprintId: sprint.id }
    }
  }

  if (query.from && query.to) {
    const from = new Date(query.from)
    const to = new Date(query.to)
    if (!isNaN(from) && !isNaN(to) && to > from) {
      return { from: startOfDay(from), to: endOfDay(to), label: `${iso(from)} → ${iso(to)}` }
    }
  }

  const presets = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, '1y': 365 }
  const days = presets[query.preset] || 14
  return { from: addDays(today, -(days - 1)), to: endOfDay(today), label: `Last ${days} days` }
}

/** Everything the report needs, computed once. */
async function buildReport(workspaceId, range) {
  const [workspace, members, tasks, statuses, events] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.task.findMany({
      where: { workspaceId },
      include: { assignedTo: { select: { id: true, name: true } }, labels: { select: { name: true } } },
    }),
    prisma.workspaceStatus.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } }),
    prisma.taskEvent.findMany({
      where: { task: { workspaceId }, createdAt: { gte: range.from, lte: range.to } },
      select: { taskId: true, type: true, oldValue: true, newValue: true, createdAt: true },
    }),
  ])

  const doneKeys = new Set(statuses.filter((s) => s.isDone).map((s) => s.key))
  const isDone = (t) => doneKeys.has(t.status)
  const today = startOfDay(new Date())

  const open = tasks.filter((t) => !isDone(t))
  const done = tasks.filter((t) => isDone(t))
  const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < today)

  // work finished inside the window — this is what every rate is based on
  const inRange = done.filter((t) => t.completedAt && new Date(t.completedAt) >= range.from && new Date(t.completedAt) <= range.to)
  const spanDays = Math.max(Math.ceil((range.to - range.from) / DAY), 1)

  const hoursOf = (list) => list.reduce((s, t) => s + (t.estimateHours || 0), 0)
  const eventsByTask = events.reduce((m, e) => { (m[e.taskId] ||= []).push(e); return m }, {})

  const cycleTimes = inRange.map((t) => taskMetrics(t, eventsByTask[t.id] || []).cycleTimeHours).filter((n) => n != null)
  const avgCycle = cycleTimes.length ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null

  const withDue = inRange.filter((t) => t.dueDate)
  const onTime = withDue.filter((t) => new Date(t.completedAt) <= new Date(t.dueDate))

  /* ---------- per member ---------- */
  const memberRows = members.map((m) => {
    const mine = tasks.filter((t) => t.assignedToId === m.userId)
    const myOpen = mine.filter((t) => !isDone(t))
    const myOverdue = myOpen.filter((t) => t.dueDate && new Date(t.dueDate) < today)
    const myDone = inRange.filter((t) => t.assignedToId === m.userId)
    const myWithDue = myDone.filter((t) => t.dueDate)
    const myOnTime = myWithDue.filter((t) => new Date(t.completedAt) <= new Date(t.dueDate))

    const myCycles = myDone.map((t) => taskMetrics(t, eventsByTask[t.id] || []).cycleTimeHours).filter((n) => n != null)
    const myAvgCycle = myCycles.length ? myCycles.reduce((a, b) => a + b, 0) / myCycles.length : null

    // hours per day is a better velocity than tasks per day once tasks are sized
    const hoursDone = hoursOf(myDone)
    const perDayHours = hoursDone / spanDays
    const perDayTasks = myDone.length / spanDays

    // project the open queue in due order at this person's measured pace
    const queue = [...myOpen].sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate) - new Date(b.dueDate)
    })
    const rateHours = perDayHours > 0 ? perDayHours : null
    const rateTasks = perDayTasks > 0 ? perDayTasks : 0.15
    let remaining = 0
    let atRisk = 0
    const projected = queue.map((t) => {
      let daysNeeded
      if (rateHours && t.estimateHours) {
        remaining += t.estimateHours
        daysNeeded = remaining / rateHours
      } else {
        remaining += 1
        daysNeeded = remaining / rateTasks
      }
      const eta = addDays(today, Math.ceil(daysNeeded))
      const late = t.dueDate ? eta > new Date(t.dueDate) : false
      if (late) atRisk++
      return { id: t.id, title: t.title, dueDate: t.dueDate, eta, late, estimateHours: t.estimateHours }
    })

    let status = 'on-track'
    if (myOverdue.length >= 2 || atRisk >= 3) status = 'behind'
    else if (myOverdue.length >= 1 || atRisk >= 1) status = 'at-risk'

    const onTimeRate = myWithDue.length ? Math.round((myOnTime.length / myWithDue.length) * 100) : null

    return {
      id: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      open: myOpen.length,
      overdue: myOverdue.length,
      completed: myDone.length,
      hoursCompleted: round(hoursDone),
      openHours: round(hoursOf(myOpen)),
      perDayTasks: round(perDayTasks, 2),
      perDayHours: round(perDayHours, 2),
      avgCycleTimeHours: round(myAvgCycle),
      onTimeRate,
      atRisk,
      status,
      completionRate: mine.length ? Math.round((mine.filter(isDone).length / mine.length) * 100) : 0,
      projected: projected.slice(0, 10),
      eta: projected.length ? projected[projected.length - 1].eta : null,
    }
  })

  /* ---------- ranking ----------
     A blend of output and reliability, so someone who ships a lot but always
     late doesn't outrank someone steady. Shown with the parts visible. */
  const maxDone = Math.max(...memberRows.map((m) => m.completed), 1)
  const maxHours = Math.max(...memberRows.map((m) => m.hoursCompleted || 0), 1)
  const ranked = memberRows
    .map((m) => {
      const output = ((m.completed / maxDone) * 0.5 + ((m.hoursCompleted || 0) / maxHours) * 0.5) * 60
      const reliability = ((m.onTimeRate ?? 70) / 100) * 30
      const penalty = Math.min(m.overdue * 5, 15)
      return { ...m, score: Math.max(Math.round(output + reliability - penalty), 0) }
    })
    .sort((a, b) => b.score - a.score)
    .map((m, i) => ({ ...m, rank: i + 1 }))

  /* ---------- daily completions across the range ---------- */
  const daily = []
  const bucketDays = Math.min(spanDays, 180) // keep the payload sane for a year view
  const bucketSize = Math.ceil(spanDays / bucketDays)
  for (let i = 0; i < spanDays; i += bucketSize) {
    const from = addDays(range.from, i)
    const to = new Date(Math.min(addDays(from, bucketSize).getTime(), range.to.getTime() + 1))
    const inBucket = done.filter((t) => t.completedAt && new Date(t.completedAt) >= from && new Date(t.completedAt) < to)
    daily.push({
      date: iso(from),
      label: bucketSize === 1
        ? from.toLocaleDateString('en-US', { weekday: 'short' })
        : `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      count: inBucket.length,
      hours: round(hoursOf(inBucket)),
    })
  }

  /* ---------- burndown across the range ---------- */
  const burndown = []
  const bdPoints = Math.min(spanDays, 60)
  const bdStep = Math.ceil(spanDays / bdPoints)
  for (let i = 0; i < spanDays; i += bdStep) {
    const at = addDays(range.from, i + bdStep)
    const created = tasks.filter((t) => new Date(t.createdAt) < at)
    const closed = created.filter((t) => t.completedAt && new Date(t.completedAt) < at)
    burndown.push({
      date: iso(addDays(range.from, i)),
      remaining: created.length - closed.length,
      remainingHours: round(hoursOf(created) - hoursOf(closed)),
      ideal: null,
    })
  }
  const peak = Math.max(...burndown.map((p) => p.remaining), 0)
  burndown.forEach((p, i) => {
    p.ideal = burndown.length > 1 ? Math.max(Math.round((peak * (burndown.length - 1 - i)) / (burndown.length - 1)), 0) : 0
  })

  /* ---------- forecast ---------- */
  const teamPerDay = inRange.length / spanDays
  const teamHoursPerDay = hoursOf(inRange) / spanDays
  const openHours = hoursOf(open)
  const daysToClear = teamHoursPerDay > 0 && openHours > 0
    ? Math.ceil(openHours / teamHoursPerDay)
    : teamPerDay > 0
      ? Math.ceil(open.length / teamPerDay)
      : null

  /* ---------- label breakdown ---------- */
  const labelCounts = {}
  for (const t of tasks) for (const l of t.labels) labelCounts[l.name] = (labelCounts[l.name] || 0) + 1

  return {
    workspace: workspace?.name,
    range: { from: iso(range.from), to: iso(range.to), label: range.label, days: spanDays, sprintId: range.sprintId || null },
    kpis: {
      throughput: round(teamPerDay),
      hoursPerDay: round(teamHoursPerDay),
      completedInRange: inRange.length,
      hoursCompleted: round(hoursOf(inRange)),
      onTimeRate: withDue.length ? Math.round((onTime.length / withDue.length) * 100) : null,
      avgCycleTimeHours: round(avgCycle),
      atRiskMembers: memberRows.filter((m) => m.status !== 'on-track').length,
      totalMembers: memberRows.length,
      overdueTasks: overdue.length,
      openTasks: open.length,
      openHours: round(openHours),
      doneTasks: done.length,
      estimateCoverage: tasks.length ? Math.round((tasks.filter((t) => t.estimateHours).length / tasks.length) * 100) : 0,
    },
    forecast: {
      daysToClear,
      finishesOn: daysToClear ? iso(addDays(today, daysToClear)) : null,
      message: daysToClear == null
        ? 'Not enough completed work in this range to forecast'
        : `At this pace the remaining ${open.length} open task${open.length === 1 ? '' : 's'} clear in about ${daysToClear} day${daysToClear === 1 ? '' : 's'}`,
    },
    burndown,
    daily,
    members: ranked,
    labels: Object.entries(labelCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
}

/* ------------------------------- routes ------------------------------- */

// GET /analytics/:workspaceId?preset=30d | ?from=&to= | ?sprintId=
router.get('/:workspaceId', async (req, res) => {
  const check = await requireMember(req.params.workspaceId, req.userId, 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const range = await resolveRange(req.query, req.params.workspaceId)
  const report = await buildReport(req.params.workspaceId, range)
  const sprints = await prisma.sprint.findMany({
    where: { workspaceId: req.params.workspaceId },
    orderBy: { startsAt: 'desc' },
  })
  res.json({ ...report, sprints })
})

// GET /analytics/:workspaceId/member/:userId — one person's detail
// Members may look at their own; admins may look at anyone's.
router.get('/:workspaceId/member/:userId', async (req, res) => {
  const own = req.params.userId === req.userId
  const check = await requireMember(req.params.workspaceId, req.userId, own ? 'member' : 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const range = await resolveRange(req.query, req.params.workspaceId)
  const report = await buildReport(req.params.workspaceId, range)
  const member = report.members.find((m) => m.id === req.params.userId)
  if (!member) return res.status(404).json({ error: 'Not a member of this workspace' })

  res.json({ workspace: report.workspace, range: report.range, member, teamAverage: {
    completed: round(report.members.reduce((s, m) => s + m.completed, 0) / (report.members.length || 1)),
    hoursCompleted: round(report.members.reduce((s, m) => s + (m.hoursCompleted || 0), 0) / (report.members.length || 1)),
    onTimeRate: Math.round(report.members.filter((m) => m.onTimeRate != null).reduce((s, m) => s + m.onTimeRate, 0) / (report.members.filter((m) => m.onTimeRate != null).length || 1)) || null,
  } })
})

/* --------------------------------- CSV -------------------------------- */

const csvEscape = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (headers, rows) =>
  [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'

// GET /analytics/:workspaceId/export?scope=members|tasks|summary&preset=...
router.get('/:workspaceId/export', async (req, res) => {
  const check = await requireMember(req.params.workspaceId, req.userId, 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const range = await resolveRange(req.query, req.params.workspaceId)
  const report = await buildReport(req.params.workspaceId, range)
  const scope = req.query.scope || 'members'
  const slug = (report.workspace || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-')

  let csv
  let name

  if (scope === 'tasks') {
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: req.params.workspaceId,
        ...(req.query.userId ? { assignedToId: req.query.userId } : {}),
      },
      include: { assignedTo: { select: { name: true } }, createdBy: { select: { name: true } }, labels: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    csv = toCsv(
      ['Task', 'Status', 'Priority', 'Assignee', 'Created by', 'Estimate (h)', 'Due', 'Started', 'Completed', 'Labels'],
      tasks.map((t) => [
        t.title, t.status, t.priority,
        t.assignedTo?.name || '', t.createdBy?.name || '',
        t.estimateHours ?? '',
        t.dueDate ? iso(t.dueDate) : '',
        t.startedAt ? iso(t.startedAt) : '',
        t.completedAt ? iso(t.completedAt) : '',
        t.labels.map((l) => l.name).join(' | '),
      ]),
    )
    name = `snaptask-${slug}-tasks-${report.range.from}_${report.range.to}.csv`
  } else if (scope === 'summary') {
    csv = toCsv(
      ['Metric', 'Value'],
      [
        ['Workspace', report.workspace],
        ['Range', report.range.label],
        ['From', report.range.from],
        ['To', report.range.to],
        ['Completed in range', report.kpis.completedInRange],
        ['Hours completed', report.kpis.hoursCompleted],
        ['Throughput (tasks/day)', report.kpis.throughput],
        ['Throughput (hours/day)', report.kpis.hoursPerDay],
        ['On-time completion %', report.kpis.onTimeRate ?? ''],
        ['Avg cycle time (h)', report.kpis.avgCycleTimeHours ?? ''],
        ['Open tasks', report.kpis.openTasks],
        ['Open hours', report.kpis.openHours],
        ['Overdue tasks', report.kpis.overdueTasks],
        ['Members at risk', report.kpis.atRiskMembers],
        ['Estimate coverage %', report.kpis.estimateCoverage],
        ['Forecast', report.forecast.message],
      ],
    )
    name = `snaptask-${slug}-summary-${report.range.from}_${report.range.to}.csv`
  } else {
    csv = toCsv(
      ['Rank', 'Member', 'Email', 'Role', 'Score', 'Completed', 'Hours completed', 'Open', 'Open hours', 'Overdue', 'On-time %', 'Avg cycle (h)', 'Tasks/day', 'Hours/day', 'Health'],
      report.members.map((m) => [
        m.rank, m.name, m.email, m.role, m.score,
        m.completed, m.hoursCompleted, m.open, m.openHours, m.overdue,
        m.onTimeRate ?? '', m.avgCycleTimeHours ?? '', m.perDayTasks, m.perDayHours, m.status,
      ]),
    )
    name = `snaptask-${slug}-members-${report.range.from}_${report.range.to}.csv`
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(csv)
})

module.exports = router
