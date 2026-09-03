const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')
const { taskMetrics, variance, median } = require('../lib/history')

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
 * Estimate-vs-actual for a set of tasks.
 *
 * Only tasks carrying BOTH numbers can be counted, so `coverage` is reported
 * alongside every figure — an accuracy of 100% across two tasks is not the same
 * claim as 100% across forty, and a dashboard that hides the difference invites
 * decisions the data cannot support.
 */
function planningAccuracy(tasks) {
  const rows = tasks.map((t) => ({ task: t, v: variance(t) })).filter((r) => r.v)
  const withEstimate = tasks.filter((t) => t.estimateHours).length

  if (!rows.length) {
    return {
      measured: 0,
      withEstimate,
      total: tasks.length,
      coverage: 0,
      medianRatio: null,
      overCount: 0,
      underCount: 0,
      onTargetCount: 0,
      estimatedHours: 0,
      actualHours: 0,
      biggestOverruns: [],
    }
  }

  const ratios = rows.map((r) => r.v.ratio)
  const overruns = rows
    .filter((r) => r.v.verdict === 'over')
    .sort((a, b) => b.v.deltaHours - a.v.deltaHours)
    .slice(0, 5)
    .map((r) => ({
      id: r.task.id,
      title: r.task.title,
      assignee: r.task.assignedTo?.name || null,
      estimateHours: r.v.estimateHours,
      actualHours: r.v.actualHours,
      deltaHours: r.v.deltaHours,
      ratio: r.v.ratio,
    }))

  return {
    measured: rows.length,
    withEstimate,
    total: tasks.length,
    coverage: tasks.length ? Math.round((rows.length / tasks.length) * 100) : 0,
    // median, so one task that ran 10x over does not redefine the team's habits
    medianRatio: round(median(ratios), 2),
    overCount: rows.filter((r) => r.v.verdict === 'over').length,
    underCount: rows.filter((r) => r.v.verdict === 'under').length,
    onTargetCount: rows.filter((r) => r.v.verdict === 'on-target').length,
    estimatedHours: round(rows.reduce((s, r) => s + r.v.estimateHours, 0)),
    actualHours: round(rows.reduce((s, r) => s + r.v.actualHours, 0)),
    biggestOverruns: overruns,
  }
}

/** Plain-English reading of a planning ratio, for people who don't read ratios. */
function accuracyVerdict(a) {
  if (!a.measured) {
    return a.withEstimate
      ? 'Nobody has logged time spent yet, so estimates cannot be checked against reality.'
      : 'No estimates recorded yet — add them to a few tasks to see how well the team plans.'
  }
  const pct = Math.round(Math.abs(a.medianRatio - 1) * 100)
  if (a.medianRatio > 1.15) return `Work typically takes ${pct}% longer than estimated.`
  if (a.medianRatio < 0.85) return `Work typically finishes ${pct}% faster than estimated.`
  return 'Estimates are close to reality — planning is reliable.'
}

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
    const accuracy = planningAccuracy(myDone)

    return {
      id: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      open: myOpen.length,
      overdue: myOverdue.length,
      completed: myDone.length,
      hoursCompleted: round(hoursDone),
      accuracy,
      actualHoursLogged: round(myDone.reduce((s, t) => s + (t.actualHours || 0), 0)),
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

  /* ---------- planning accuracy across the whole range ---------- */
  const accuracy = planningAccuracy(inRange)
  accuracy.verdict = accuracyVerdict(accuracy)

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
    accuracy,
    members: ranked,
    labels: Object.entries(labelCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
}

/**
 * Sprints, with enough detail that the picker can explain itself.
 *
 * "By sprint…" as a bare dropdown of names told a reader nothing: not what a
 * sprint is, not when it ran, not whether it went well. Each entry now carries
 * its dates, how much work it holds and how much is finished, so the control
 * can show "Sprint 4 · Mar 3–17 · 12 of 18 done" instead of "Sprint 4".
 */
async function sprintSummaries(workspaceId) {
  const [sprints, statuses] = await Promise.all([
    prisma.sprint.findMany({
      where: { workspaceId },
      orderBy: { startsAt: 'desc' },
      include: { tasks: { select: { id: true, status: true, estimateHours: true, actualHours: true } } },
    }),
    prisma.workspaceStatus.findMany({ where: { workspaceId }, select: { key: true, isDone: true } }),
  ])

  const doneKeys = new Set(statuses.filter((s) => s.isDone).map((s) => s.key))
  const now = new Date()

  return sprints.map((s) => {
    const done = s.tasks.filter((t) => doneKeys.has(t.status))
    const start = new Date(s.startsAt)
    const end = new Date(s.endsAt)
    const totalDays = Math.max(Math.ceil((end - start) / DAY), 1)
    const elapsed = Math.min(Math.max(Math.ceil((now - start) / DAY), 0), totalDays)

    return {
      id: s.id,
      name: s.name,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      // past | active | upcoming — the reader's first question about any sprint
      state: now < start ? 'upcoming' : now > end ? 'past' : 'active',
      totalDays,
      daysElapsed: elapsed,
      daysLeft: Math.max(totalDays - elapsed, 0),
      taskCount: s.tasks.length,
      doneCount: done.length,
      percentDone: s.tasks.length ? Math.round((done.length / s.tasks.length) * 100) : 0,
      estimatedHours: round(s.tasks.reduce((a, t) => a + (t.estimateHours || 0), 0)),
      actualHours: round(s.tasks.reduce((a, t) => a + (t.actualHours || 0), 0)),
    }
  })
}

/* ------------------------------- routes ------------------------------- */

// GET /analytics/:workspaceId?preset=30d | ?from=&to= | ?sprintId=
router.get('/:workspaceId', async (req, res) => {
  const check = await requireMember(req.params.workspaceId, req.userId, 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const range = await resolveRange(req.query, req.params.workspaceId)
  const report = await buildReport(req.params.workspaceId, range)
  res.json({ ...report, sprints: await sprintSummaries(req.params.workspaceId) })
})

/**
 * One person's detail.
 *
 * Members may look at their own; admins may look at anyone's. The point of this
 * endpoint is to answer "how is this person actually doing" with things a
 * manager can act on, rather than a score — so every figure comes with the
 * team's own median beside it. A number like "avg cycle time 40h" means nothing
 * until you know the team sits at 12h or at 60h.
 */
router.get('/:workspaceId/member/:userId', async (req, res) => {
  const own = req.params.userId === req.userId
  const check = await requireMember(req.params.workspaceId, req.userId, own ? 'member' : 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const range = await resolveRange(req.query, req.params.workspaceId)
  const report = await buildReport(req.params.workspaceId, range)
  const member = report.members.find((m) => m.id === req.params.userId)
  if (!member) return res.status(404).json({ error: 'Not a member of this workspace' })

  const [tasks, statuses, events] = await Promise.all([
    prisma.task.findMany({
      where: { workspaceId: req.params.workspaceId, assignedToId: req.params.userId },
      include: { labels: { select: { name: true } }, assignedTo: { select: { name: true } } },
    }),
    prisma.workspaceStatus.findMany({ where: { workspaceId: req.params.workspaceId } }),
    prisma.taskEvent.findMany({
      where: { task: { workspaceId: req.params.workspaceId, assignedToId: req.params.userId } },
      select: { taskId: true, type: true, oldValue: true, newValue: true, createdAt: true },
    }),
  ])

  const doneKeys = new Set(statuses.filter((s) => s.isDone).map((s) => s.key))
  const isDone = (t) => doneKeys.has(t.status)
  const today = startOfDay(new Date())
  const eventsByTask = events.reduce((m, e) => { (m[e.taskId] ||= []).push(e); return m }, {})

  const doneInRange = tasks.filter(
    (t) => isDone(t) && t.completedAt && new Date(t.completedAt) >= range.from && new Date(t.completedAt) <= range.to,
  )
  const openTasks = tasks.filter((t) => !isDone(t))

  /* ---------- their own completion trend over the range ---------- */
  const spanDays = Math.max(Math.ceil((range.to - range.from) / DAY), 1)
  const buckets = Math.min(spanDays, 60)
  const step = Math.ceil(spanDays / buckets)
  const daily = []
  for (let i = 0; i < spanDays; i += step) {
    const from = addDays(range.from, i)
    const to = new Date(Math.min(addDays(from, step).getTime(), range.to.getTime() + 1))
    const inBucket = doneInRange.filter((t) => new Date(t.completedAt) >= from && new Date(t.completedAt) < to)
    daily.push({
      date: iso(from),
      label: step === 1
        ? from.toLocaleDateString('en-US', { weekday: 'short' })
        : from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: inBucket.length,
      hours: round(inBucket.reduce((s, t) => s + (t.actualHours || t.estimateHours || 0), 0)),
    })
  }

  /* ---------- where the time actually went ---------- */
  // Slowest by cycle time, and separately the biggest overruns against estimate.
  // These answer different questions: "what dragged" vs "what was mis-planned".
  const slowest = doneInRange
    .map((t) => ({ t, m: taskMetrics(t, eventsByTask[t.id] || []) }))
    .filter((x) => x.m.cycleTimeHours != null)
    .sort((a, b) => b.m.cycleTimeHours - a.m.cycleTimeHours)
    .slice(0, 5)
    .map((x) => ({
      id: x.t.id,
      title: x.t.title,
      cycleTimeHours: round(x.m.cycleTimeHours),
      estimateHours: x.t.estimateHours,
      actualHours: x.t.actualHours,
      dueMoves: x.m.dueMoves,
    }))

  const accuracy = planningAccuracy(doneInRange)
  accuracy.verdict = accuracyVerdict(accuracy)

  /* ---------- stalled work: open, started, and sitting ---------- */
  const stalled = openTasks
    .filter((t) => t.startedAt)
    .map((t) => ({ t, hours: (Date.now() - new Date(t.startedAt)) / 3600000 }))
    .filter((x) => x.hours > 48)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5)
    .map((x) => ({
      id: x.t.id,
      title: x.t.title,
      status: x.t.status,
      inProgressHours: round(x.hours),
      dueDate: x.t.dueDate,
      overdue: Boolean(x.t.dueDate && new Date(x.t.dueDate) < today),
    }))

  /* ---------- deadline discipline ---------- */
  const myEvents = Object.values(eventsByTask).flat()
  const duePushes = myEvents.filter(
    (e) => e.type === 'due' && e.oldValue && e.newValue && new Date(e.newValue) > new Date(e.oldValue),
  ).length

  /* ---------- what they work on ---------- */
  const labelCounts = {}
  for (const t of doneInRange) for (const l of t.labels) labelCounts[l.name] = (labelCounts[l.name] || 0) + 1

  /* ---------- the team's median, for context ---------- */
  const peers = report.members.filter((m) => m.id !== member.id)
  const teamMedian = {
    completed: round(median(report.members.map((m) => m.completed))),
    hoursCompleted: round(median(report.members.map((m) => m.hoursCompleted || 0))),
    onTimeRate: round(median(report.members.map((m) => m.onTimeRate).filter((n) => n != null)), 0),
    avgCycleTimeHours: round(median(report.members.map((m) => m.avgCycleTimeHours).filter((n) => n != null))),
    score: round(median(report.members.map((m) => m.score)), 0),
    memberCount: report.members.length,
    peerCount: peers.length,
  }

  /* ---------- plain-English highlights ----------
     A manager should not have to derive the story from eight numbers. These
     are stated as observations, never as judgements about the person: the data
     supports "three tasks are overdue", not "is unreliable". */
  const highlights = []
  const cmp = (mine, theirs, better = 'higher') => {
    if (mine == null || theirs == null || theirs === 0) return null
    const pct = Math.round(((mine - theirs) / theirs) * 100)
    if (Math.abs(pct) < 20) return null
    return { pct: Math.abs(pct), above: better === 'higher' ? pct > 0 : pct < 0 }
  }

  const outputCmp = cmp(member.completed, teamMedian.completed)
  if (outputCmp) {
    highlights.push({
      tone: outputCmp.above ? 'good' : 'watch',
      text: `Completed ${outputCmp.pct}% ${outputCmp.above ? 'more' : 'fewer'} tasks than the team median in this range.`,
    })
  }

  const cycleCmp = cmp(member.avgCycleTimeHours, teamMedian.avgCycleTimeHours, 'lower')
  if (cycleCmp) {
    highlights.push({
      tone: cycleCmp.above ? 'good' : 'watch',
      text: cycleCmp.above
        ? `Finishes work ${cycleCmp.pct}% faster than the team median once started.`
        : `Work sits ${cycleCmp.pct}% longer in progress than the team median — worth asking what is blocking it.`,
    })
  }

  if (member.onTimeRate != null) {
    highlights.push({
      tone: member.onTimeRate >= 80 ? 'good' : member.onTimeRate >= 50 ? 'watch' : 'risk',
      text: `Hit the deadline on ${member.onTimeRate}% of dated work.`,
    })
  }

  if (member.overdue > 0) {
    highlights.push({
      tone: member.overdue >= 3 ? 'risk' : 'watch',
      text: `${member.overdue} open task${member.overdue === 1 ? '' : 's'} past the due date right now.`,
    })
  }

  if (accuracy.measured >= 3) {
    highlights.push({
      tone: accuracy.medianRatio > 1.3 ? 'watch' : 'good',
      text: accuracy.medianRatio > 1.15
        ? `Their tasks take about ${Math.round((accuracy.medianRatio - 1) * 100)}% longer than they estimate — estimates may need padding.`
        : accuracy.medianRatio < 0.85
          ? `Finishes about ${Math.round((1 - accuracy.medianRatio) * 100)}% faster than estimated — estimates may be too cautious.`
          : 'Estimates land close to reality.',
    })
  }

  if (duePushes >= 3) {
    highlights.push({ tone: 'watch', text: `Pushed a deadline back ${duePushes} times — a sign of over-commitment or unclear scope.` })
  }

  if (stalled.length) {
    highlights.push({ tone: 'watch', text: `${stalled.length} task${stalled.length === 1 ? ' has' : 's have'} been in progress for over two days.` })
  }

  if (!highlights.length) {
    highlights.push({ tone: 'good', text: 'Nothing stands out either way in this range — steady.' })
  }

  res.json({
    workspace: report.workspace,
    range: report.range,
    member,
    teamMedian,
    daily,
    accuracy,
    slowest,
    stalled,
    duePushes,
    labels: Object.entries(labelCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    highlights,
    // kept for anything still reading the old shape
    teamAverage: teamMedian,
  })
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
      ['Task', 'Status', 'Priority', 'Assignee', 'Created by', 'Estimate (h)', 'Actual (h)', 'Variance (h)', 'Due', 'Started', 'Completed', 'Labels'],
      tasks.map((t) => [
        t.title, t.status, t.priority,
        t.assignedTo?.name || '', t.createdBy?.name || '',
        t.estimateHours ?? '',
        t.actualHours ?? '',
        t.estimateHours && t.actualHours != null ? round(t.actualHours - t.estimateHours) : '',
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
        ['Planning: tasks measured', report.accuracy.measured],
        ['Planning: median actual/estimate', report.accuracy.medianRatio ?? ''],
        ['Planning: estimated hours', report.accuracy.estimatedHours],
        ['Planning: actual hours', report.accuracy.actualHours],
        ['Planning: verdict', report.accuracy.verdict],
        ['Forecast', report.forecast.message],
      ],
    )
    name = `snaptask-${slug}-summary-${report.range.from}_${report.range.to}.csv`
  } else {
    csv = toCsv(
      ['Rank', 'Member', 'Email', 'Role', 'Score', 'Completed', 'Hours completed', 'Hours logged', 'Open', 'Open hours', 'Overdue', 'On-time %', 'Avg cycle (h)', 'Tasks/day', 'Hours/day', 'Estimate accuracy (x)', 'Tasks measured', 'Health'],
      report.members.map((m) => [
        m.rank, m.name, m.email, m.role, m.score,
        m.completed, m.hoursCompleted, m.actualHoursLogged ?? '', m.open, m.openHours, m.overdue,
        m.onTimeRate ?? '', m.avgCycleTimeHours ?? '', m.perDayTasks, m.perDayHours,
        m.accuracy?.medianRatio ?? '', m.accuracy?.measured ?? 0, m.status,
      ]),
    )
    name = `snaptask-${slug}-members-${report.range.from}_${report.range.to}.csv`
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(csv)
})

module.exports = router
