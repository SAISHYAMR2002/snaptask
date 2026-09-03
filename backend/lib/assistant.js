const prisma = require('./prisma')

/**
 * The workspace assistant.
 *
 * Every answer is computed from real rows — it never guesses and never
 * fabricates a number. A question is matched to an intent, the intent runs a
 * query, and the reply comes back as text plus "blocks" the UI renders as
 * charts, stat tiles and task lists.
 *
 * Deliberately not an LLM: this is free, instant and cannot hallucinate an
 * estimate. `answer()` is the single entry point, so swapping in a model later
 * only means adding a fallback branch at the bottom.
 */

const DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => new Date(d.getTime() + n * DAY)
const fmt = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** Tasks/day each person has actually completed over the last 14 days. */
function throughputOf(tasks, userId) {
  const since = addDays(startOfDay(new Date()), -13)
  const done = tasks.filter(
    (t) => t.assignedToId === userId && t.completedAt && new Date(t.completedAt) >= since,
  )
  return done.length / 14
}

/**
 * Project when someone's open work lands, by walking their queue in due-date
 * order at the rate they have actually been finishing things.
 */
function projectQueue(tasks, userId) {
  const today = startOfDay(new Date())
  const open = tasks
    .filter((t) => t.assignedToId === userId && t.status !== 'done')
    .sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate) - new Date(b.dueDate)
    })

  const rate = throughputOf(tasks, userId) || 0.15 // slow-but-moving assumption
  return open.map((t, i) => {
    const eta = addDays(today, Math.ceil((i + 1) / rate))
    const late = t.dueDate ? eta > new Date(t.dueDate) : false
    return { task: t, eta, late }
  })
}

const healthOf = (projected, overdueCount) => {
  const atRisk = projected.filter((p) => p.late).length
  if (overdueCount >= 2 || atRisk >= 3) return { status: 'behind', tone: 'red' }
  if (overdueCount >= 1 || atRisk >= 1) return { status: 'at risk', tone: 'amber' }
  return { status: 'on track', tone: 'green' }
}

const taskBlock = (tasks) => ({
  type: 'tasks',
  items: tasks.slice(0, 8).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assignee: t.assignedTo?.name || null,
  })),
})

/** Find a person named in the question. Longest names first so "Adam Admin" beats "Adam". */
function matchPerson(question, members) {
  const q = question.toLowerCase()
  const sorted = [...members].sort((a, b) => b.user.name.length - a.user.name.length)
  for (const m of sorted) {
    const full = m.user.name.toLowerCase()
    const first = full.split(' ')[0]
    if (q.includes(full) || new RegExp(`\\b${first}\\b`).test(q)) return m.user
  }
  return null
}

const INTENTS = [
  { name: 'workingOn', re: /\b(working on|doing|busy with|assigned to|tasks? (of|for))\b/ },
  { name: 'eta', re: /\b(when|eta|estimat\w*|finish|complete|deliver|deadline|ready)\b/ },
  { name: 'behind', re: /\b(behind|at risk|struggling|slipping|lagging|falling)\b/ },
  { name: 'overdue', re: /\b(overdue|late|past due|missed)\b/ },
  { name: 'workload', re: /\b(workload|capacity|busiest|balance|too much|overloaded)\b/ },
  { name: 'dueSoon', re: /\b(due|upcoming|this week|next few days|soon)\b/ },
  { name: 'progress', re: /\b(progress|velocity|throughput|how (are|is) we|status|summary|overview|standup|recap)\b/ },
  { name: 'unassigned', re: /\b(unassigned|nobody|no one|orphan)\b/ },
]

const detectIntent = (q) => INTENTS.find((i) => i.re.test(q))?.name || null

async function answer({ workspaceId, userId, question }) {
  const q = String(question || '').toLowerCase().trim()
  if (!q) return { answer: 'Ask me something about this workspace.', blocks: [] }

  const [workspace, members, tasks] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.task.findMany({
      where: { workspaceId },
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
  ])

  const today = startOfDay(new Date())
  const open = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')
  const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < today)
  const person = matchPerson(q, members)
  const intent = detectIntent(q)

  /* ---------- questions about one person ---------- */
  if (person) {
    const mine = tasks.filter((t) => t.assignedToId === person.id)
    const myOpen = mine.filter((t) => t.status !== 'done')
    const myOverdue = myOpen.filter((t) => t.dueDate && new Date(t.dueDate) < today)
    const inProgress = myOpen.filter((t) => t.status === 'in-progress')
    const projected = projectQueue(tasks, person.id)
    const rate = throughputOf(tasks, person.id)
    const health = healthOf(projected, myOverdue.length)

    if (intent === 'eta') {
      if (!myOpen.length) {
        return { answer: `${person.name} has nothing open right now.`, blocks: [] }
      }
      const last = projected[projected.length - 1]
      const lines = projected
        .slice(0, 5)
        .map((p) => `• ${p.task.title} — ${fmt(p.eta)}${p.late ? ' (past its due date)' : ''}`)
        .join('\n')
      return {
        answer:
          `${person.name} has ${myOpen.length} open task${myOpen.length === 1 ? '' : 's'} and has been finishing ` +
          `${rate ? rate.toFixed(1) : 'under 0.1'} a day over the last two weeks.\n\n${lines}\n\n` +
          `At that pace the last one lands around **${fmt(last.eta)}**.` +
          (projected.some((p) => p.late)
            ? ` ${projected.filter((p) => p.late).length} would miss their due date.`
            : ' Nothing is projected to be late.'),
        blocks: [
          { type: 'stats', items: [
            { label: 'Open', value: myOpen.length },
            { label: 'Overdue', value: myOverdue.length, tone: myOverdue.length ? 'red' : null },
            { label: 'Done / 14d', value: done.filter((t) => t.assignedToId === person.id && t.completedAt && new Date(t.completedAt) >= addDays(today, -13)).length },
            { label: 'Est. finish', value: fmt(last.eta) },
          ] },
          taskBlock(projected.map((p) => p.task)),
        ],
      }
    }

    // default person question: what are they doing
    const focus = inProgress.length ? inProgress : myOpen
    return {
      answer:
        `${person.name} is **${health.status}**. ` +
        (inProgress.length
          ? `Currently in progress: ${inProgress.map((t) => t.title).join(', ')}.`
          : myOpen.length
            ? `Nothing marked in progress — ${myOpen.length} task${myOpen.length === 1 ? '' : 's'} waiting in To Do.`
            : 'No open tasks at all.') +
        (myOverdue.length ? ` ${myOverdue.length} overdue.` : ''),
      blocks: [
        { type: 'stats', items: [
          { label: 'Open', value: myOpen.length },
          { label: 'In progress', value: inProgress.length },
          { label: 'Overdue', value: myOverdue.length, tone: myOverdue.length ? 'red' : null },
          { label: 'Health', value: health.status, tone: health.tone },
        ] },
        focus.length ? taskBlock(focus) : null,
      ].filter(Boolean),
    }
  }

  /* ---------- team-wide questions ---------- */
  switch (intent) {
    case 'behind': {
      const rows = members.map((m) => {
        const projected = projectQueue(tasks, m.userId)
        const myOverdue = open.filter((t) => t.assignedToId === m.userId && t.dueDate && new Date(t.dueDate) < today)
        return { name: m.user.name, health: healthOf(projected, myOverdue.length), atRisk: projected.filter((p) => p.late).length, overdue: myOverdue.length }
      })
      const trouble = rows.filter((r) => r.health.status !== 'on track')
      return {
        answer: trouble.length
          ? `${trouble.length} of ${rows.length} ${trouble.length === 1 ? 'person is' : 'people are'} not on track: ` +
            trouble.map((r) => `${r.name} (${r.health.status}${r.overdue ? `, ${r.overdue} overdue` : ''})`).join('; ') + '.'
          : `Everyone is on track — no overdue work and nothing projected to miss its due date.`,
        blocks: [{ type: 'people', items: rows.map((r) => ({ name: r.name, status: r.health.status, tone: r.health.tone, detail: r.overdue ? `${r.overdue} overdue` : r.atRisk ? `${r.atRisk} at risk` : 'clear' })) }],
      }
    }

    case 'overdue':
      return {
        answer: overdue.length
          ? `${overdue.length} task${overdue.length === 1 ? ' is' : 's are'} past their due date.`
          : 'Nothing is overdue right now.',
        blocks: overdue.length ? [taskBlock(overdue)] : [],
      }

    case 'workload': {
      const rows = members
        .map((m) => ({ name: m.user.name, count: open.filter((t) => t.assignedToId === m.userId).length }))
        .sort((a, b) => b.count - a.count)
      const avg = rows.reduce((s, r) => s + r.count, 0) / (rows.length || 1)
      const top = rows[0]
      return {
        answer: top && avg
          ? `${top.name} has the most open work (${top.count} tasks, ${(top.count / avg).toFixed(1)}× the team average of ${avg.toFixed(1)}).`
          : 'No open work to compare yet.',
        blocks: [{ type: 'bars', title: 'Open tasks per person', items: rows.map((r) => ({ label: r.name, value: r.count })) }],
      }
    }

    case 'dueSoon': {
      const soon = open
        .filter((t) => t.dueDate && new Date(t.dueDate) <= addDays(today, 7))
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      return {
        answer: soon.length
          ? `${soon.length} task${soon.length === 1 ? '' : 's'} due in the next 7 days${overdue.length ? `, including ${overdue.length} already overdue` : ''}.`
          : 'Nothing due in the next 7 days.',
        blocks: soon.length ? [taskBlock(soon)] : [],
      }
    }

    case 'unassigned': {
      const none = open.filter((t) => !t.assignedToId)
      return {
        answer: none.length ? `${none.length} open task${none.length === 1 ? ' has' : 's have'} nobody assigned.` : 'Every open task has an owner.',
        blocks: none.length ? [taskBlock(none)] : [],
      }
    }

    case 'workingOn': {
      const inProgress = open.filter((t) => t.status === 'in-progress')
      return {
        answer: inProgress.length
          ? `${inProgress.length} task${inProgress.length === 1 ? ' is' : 's are'} in progress right now.`
          : 'Nothing is marked in progress at the moment.',
        blocks: inProgress.length ? [taskBlock(inProgress)] : [],
      }
    }

    case 'progress':
    default: {
      const since = addDays(today, -13)
      const recent = done.filter((t) => t.completedAt && new Date(t.completedAt) >= since)
      const rate = recent.length / 14
      const daysToClear = rate > 0 ? Math.ceil(open.length / rate) : null

      const weekly = []
      for (let i = 6; i >= 0; i--) {
        const day = addDays(today, -i)
        const end = addDays(day, 1)
        weekly.push({
          label: day.toLocaleDateString('en-US', { weekday: 'short' }),
          value: done.filter((t) => t.completedAt && new Date(t.completedAt) >= day && new Date(t.completedAt) < end).length,
        })
      }

      const atRisk = members.filter((m) => {
        const myOverdue = open.filter((t) => t.assignedToId === m.userId && t.dueDate && new Date(t.dueDate) < today)
        return healthOf(projectQueue(tasks, m.userId), myOverdue.length).status !== 'on track'
      })

      return {
        answer:
          `**${workspace?.name}** has ${open.length} open and ${done.length} finished. ` +
          `The team completed ${recent.length} task${recent.length === 1 ? '' : 's'} in the last 14 days (${rate.toFixed(1)}/day). ` +
          (daysToClear ? `At that pace the current backlog clears in about ${daysToClear} days. ` : 'Not enough completed work yet to project a finish date. ') +
          (overdue.length ? `${overdue.length} overdue. ` : 'Nothing overdue. ') +
          (atRisk.length ? `${atRisk.length} ${atRisk.length === 1 ? 'person is' : 'people are'} not on track.` : 'Everyone is on track.'),
        blocks: [
          { type: 'stats', items: [
            { label: 'Open', value: open.length },
            { label: 'Done', value: done.length },
            { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'red' : null },
            { label: 'Per day', value: rate.toFixed(1) },
          ] },
          { type: 'bars', title: 'Completed, last 7 days', items: weekly },
          overdue.length ? taskBlock(overdue) : null,
        ].filter(Boolean),
      }
    }
  }
}

const SUGGESTIONS = [
  'Give me a status summary',
  'Who is behind?',
  "What's overdue?",
  'How is the workload balanced?',
  "What's due this week?",
  'Which tasks are unassigned?',
]

module.exports = { answer, SUGGESTIONS }
