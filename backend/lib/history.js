const prisma = require('./prisma')
const { logger } = require('./logger')

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
  actual: 'logged time spent',
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
    logger.error('could not record task history', { component: 'history', err: err.message })
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
  push('actual', before.actualHours, after.actualHours)

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
  if (e.type === 'actual') {
    if (!e.newValue) return 'cleared the time spent'
    return `logged ${e.newValue}h spent`
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

/**
 * How a task's real effort compared to what was planned.
 *
 * Only tasks with BOTH an estimate and logged time can answer this. Falling
 * back to elapsed calendar time would be worse than saying nothing: a task
 * started on Friday and finished on Monday shows 72 hours of "effort" that
 * nobody worked, and that number would then flow into every average on the
 * page. Coverage is reported instead, so a thin sample is visible rather than
 * disguised.
 *
 *   ratio  > 1  took longer than planned
 *   ratio == 1  on the money
 *   ratio  < 1  finished quicker
 */
function variance(task) {
  const est = task.estimateHours
  const act = task.actualHours
  if (!est || est <= 0 || act == null || act < 0) return null
  return {
    estimateHours: est,
    actualHours: act,
    deltaHours: Number((act - est).toFixed(2)),
    ratio: Number((act / est).toFixed(3)),
    // 15% either way is noise, not a planning problem
    verdict: act / est > 1.15 ? 'over' : act / est < 0.85 ? 'under' : 'on-target',
  }
}

/** Median, not mean: one 10x outlier should not redefine how a team plans. */
function median(values) {
  const v = values.filter((n) => n != null).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

module.exports = { record, diffTask, describe, taskMetrics, variance, median, LABELS }
