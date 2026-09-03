const prisma = require('./prisma')

/**
 * Task history.
 *
 * Every meaningful change appends a row rather than only mutating the task, so
 * we can answer questions current state can't: how long something sat in
 * progress, how many times a deadline moved, who reassigned it and when.
 */

const LABELS = {
  created: 'created this task',
  status: 'changed status',
  assignee: 'changed the assignee',
  due: 'changed the due date',
  priority: 'changed priority',
  estimate: 'changed the estimate',
  title: 'renamed the task',
  description: 'edited the description',
  label: 'changed labels',
  subtask: 'updated the checklist',
  sprint: 'moved sprint',
}

/** Record one or more events. Never throws — history must not break a write. */
async function record(taskId, actorId, events) {
  const rows = (Array.isArray(events) ? events : [events]).filter(Boolean).map((e) => ({
    taskId,
    actorId: actorId || null,
    type: e.type,
    field: e.field || null,
    oldValue: e.oldValue == null ? null : String(e.oldValue).slice(0, 300),
    newValue: e.newValue == null ? null : String(e.newValue).slice(0, 300),
  }))
  if (!rows.length) return
  try {
    await prisma.taskEvent.createMany({ data: rows })
  } catch (err) {
    console.error('[history] could not record:', err.message)
  }
}

/**
 * Compare a task before and after a patch and produce the events.
 * `resolve` turns ids into readable names for the activity feed.
 */
function diffTask(before, after, resolve = {}) {
  const events = []
  const push = (type, oldValue, newValue) => {
    if (String(oldValue ?? '') !== String(newValue ?? '')) events.push({ type, oldValue, newValue })
  }

  push('title', before.title, after.title)
  push('status', before.status, after.status)
  push('priority', before.priority, after.priority)
  push('estimate', before.estimateHours, after.estimateHours)

  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null)
  push('due', d(before.dueDate), d(after.dueDate))

  if (before.assignedToId !== after.assignedToId) {
    events.push({
      type: 'assignee',
      oldValue: resolve[before.assignedToId] || (before.assignedToId ? 'someone' : 'nobody'),
      newValue: resolve[after.assignedToId] || (after.assignedToId ? 'someone' : 'nobody'),
    })
  }

  if ((before.description || '') !== (after.description || '')) {
    events.push({ type: 'description' })
  }

  return events
}

/** Human sentence for one event, used by the activity feed. */
function describe(e) {
  const base = LABELS[e.type] || 'made a change'
  if (e.type === 'status') return `moved it from ${e.oldValue || '—'} to ${e.newValue || '—'}`
  if (e.type === 'assignee') return `reassigned it from ${e.oldValue} to ${e.newValue}`
  if (e.type === 'due') {
    if (!e.oldValue) return `set the due date to ${e.newValue}`
    if (!e.newValue) return 'removed the due date'
    return `moved the due date from ${e.oldValue} to ${e.newValue}`
  }
  if (e.type === 'priority') return `changed priority from ${e.oldValue} to ${e.newValue}`
  if (e.type === 'estimate') {
    if (!e.newValue) return 'removed the estimate'
    return `set the estimate to ${e.newValue}h`
  }
  if (e.type === 'title') return `renamed it to "${e.newValue}"`
  if (e.type === 'label') return e.newValue ? `added the label "${e.newValue}"` : `removed the label "${e.oldValue}"`
  return base
}

/**
 * Derived timing metrics for one task.
 *  cycleTime  — started -> completed, in hours
 *  leadTime   — created -> completed, in hours
 *  dueMoves   — how many times the deadline was pushed
 */
function taskMetrics(task, events = []) {
  const hrs = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 3600000 : null)
  const dueMoves = events.filter((e) => e.type === 'due' && e.oldValue && e.newValue).length
  const pushedOut = events.filter(
    (e) => e.type === 'due' && e.oldValue && e.newValue && new Date(e.newValue) > new Date(e.oldValue),
  ).length

  return {
    cycleTimeHours: hrs(task.startedAt, task.completedAt),
    leadTimeHours: hrs(task.createdAt, task.completedAt),
    ageHours: task.completedAt ? null : hrs(task.createdAt, new Date()),
    inProgressHours: task.startedAt && !task.completedAt ? hrs(task.startedAt, new Date()) : null,
    dueMoves,
    pushedOut,
  }
}

module.exports = { record, diffTask, describe, taskMetrics, LABELS }
