import { useEffect, useRef, useState } from 'react'
import {
  addComment,
  addSubtask,
  createLabel,
  deleteSubtask,
  getComments,
  getTaskActivity,
  updateSubtask,
} from '../lib/api'
import { LABEL_COLORS, PRIORITIES, formatDue, formatHours, labelMeta } from '../lib/helpers'
import {
  Avatar,
  Button,
  IconCheck,
  IconHistory,
  IconMessage,
  IconPlus,
  IconSend,
  IconTrash,
  IconX,
  Spinner,
} from './ui'

const fieldSelect =
  'rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-ink-soft outline-none focus:border-brand-500'

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export default function TaskDetailPanel({
  task,
  members = [],
  columns = [],
  workspaceLabels = [],
  onPatch,
  onDelete,
  onClose,
  onTaskChange,
  onLabelsChange,
  showError,
}) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [estimate, setEstimate] = useState(task.estimateHours ?? '')
  const [tab, setTab] = useState('comments')

  const [comments, setComments] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [commentError, setCommentError] = useState('')

  const [activity, setActivity] = useState(null)
  const [labelOpen, setLabelOpen] = useState(false)

  const subtasks = task.subtasks || []

  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description || '')
    setEstimate(task.estimateHours ?? '')
    setComments(null)
    setActivity(null)
    setTab('comments')
    getComments(task.id).then(setComments).catch(() => setComments([]))
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The history feed is only fetched when you actually open the tab — most
  // people never do, and it's the one query here that can return 100 rows.
  useEffect(() => {
    if (tab !== 'activity' || activity) return
    getTaskActivity(task.id)
      .then(setActivity)
      .catch(() => setActivity({ events: [], metrics: {} }))
  }, [tab, task.id, activity])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && (labelOpen ? setLabelOpen(false) : onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, labelOpen])

  const due = formatDue(task.dueDate)
  const dueValue = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : ''

  const postComment = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setCommentError('')
    try {
      const c = await addComment(task.id, text)
      setComments((prev) => [...(prev || []), c])
      setDraft('')
    } catch (err) {
      // keep the draft so nothing typed is lost, and say what happened
      setCommentError(err.response?.data?.error || 'Could not post that comment')
    } finally {
      setSending(false)
    }
  }

  /* ---- subtasks: mutate through onTaskChange so the card badge stays in sync ---- */
  const setSubtasks = (next) => onTaskChange?.({ subtasks: next })

  const toggleSubtask = async (s) => {
    setSubtasks(subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))
    try {
      await updateSubtask(s.id, { done: !s.done })
    } catch (e) {
      setSubtasks(subtasks) // put the tick back where it was
      showError?.(e, 'Could not update that item')
    }
  }

  const removeSubtask = async (s) => {
    setSubtasks(subtasks.filter((x) => x.id !== s.id))
    try {
      await deleteSubtask(s.id)
    } catch (e) {
      setSubtasks(subtasks)
      showError?.(e, 'Could not delete that item')
    }
  }

  const toggleLabel = async (label) => {
    const on = task.labels?.some((l) => l.id === label.id)
    const next = on
      ? task.labels.filter((l) => l.id !== label.id)
      : [...(task.labels || []), label]
    onPatch({ labelIds: next.map((l) => l.id) })
  }

  const done = subtasks.filter((s) => s.done).length

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-scrim/45" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[460px] flex-col border-l border-line bg-surface shadow-[-16px_0_48px_rgba(30,27,46,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-4">
          <span className="text-xs font-bold tracking-wide text-faint">
            {task.createdBy?.name ? `Created by ${task.createdBy.name}` : 'Task'}
          </span>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            <IconX size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && onPatch({ title: title.trim() })}
            className="font-display text-[18px] font-extrabold leading-snug tracking-tight bg-transparent outline-none"
          />

          <div className="flex flex-col gap-3">
            <Row label="Status">
              <select
                value={task.status}
                onChange={(e) => onPatch({ status: e.target.value })}
                className={fieldSelect}
              >
                {columns.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Priority">
              <select
                value={task.priority}
                onChange={(e) => onPatch({ priority: e.target.value })}
                className={fieldSelect}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Assignee">
              <div className="flex items-center gap-2">
                {task.assignedTo && <Avatar name={task.assignedTo.name} size={22} />}
                <select
                  value={task.assignedTo?.id || ''}
                  onChange={(e) => onPatch({ assignedToId: e.target.value || null })}
                  className={fieldSelect}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </Row>
            <Row label="Due date">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dueValue}
                  onChange={(e) => onPatch({ dueDate: e.target.value || null })}
                  className={fieldSelect}
                />
                {due?.overdue && task.status !== 'done' && (
                  <span className="text-[11px] font-bold text-red-600">Overdue</span>
                )}
              </div>
            </Row>
            <Row label="Estimate">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimate}
                  placeholder="—"
                  onChange={(e) => setEstimate(e.target.value)}
                  onBlur={() => {
                    const next = estimate === '' ? null : Number(estimate)
                    if (next !== (task.estimateHours ?? null)) onPatch({ estimateHours: next })
                  }}
                  className={`${fieldSelect} w-20`}
                />
                <span className="text-[12px] font-semibold text-faint">hours</span>
              </div>
            </Row>
          </div>

          {/* labels */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-faint">Labels</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {(task.labels || []).map((l) => (
                <span
                  key={l.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${labelMeta(l.color).chip}`}
                >
                  {l.name}
                  <button
                    onClick={() => toggleLabel(l)}
                    className="opacity-60 hover:opacity-100"
                    aria-label={`Remove ${l.name}`}
                  >
                    <IconX size={10} />
                  </button>
                </span>
              ))}
              <div className="relative">
                <button
                  onClick={() => setLabelOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11.5px] font-bold text-muted hover:border-brand-500 hover:text-brand-600"
                >
                  <IconPlus size={10} /> Label
                </button>
                {labelOpen && (
                  <LabelPicker
                    all={workspaceLabels}
                    selected={task.labels || []}
                    onToggle={toggleLabel}
                    onClose={() => setLabelOpen(false)}
                    onCreate={async (name, color) => {
                      try {
                        const l = await createLabel(task.workspaceId, name, color)
                        await onLabelsChange?.()
                        onPatch({ labelIds: [...(task.labels || []).map((x) => x.id), l.id] })
                      } catch (e) {
                        showError?.(e, 'Could not create that label')
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-faint">Description</span>
            <textarea
              rows={4}
              value={description}
              placeholder="Add a description…"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                description !== (task.description || '') &&
                onPatch({ description: description.trim() || null })
              }
              className="resize-none rounded-xl border-[1.5px] border-line bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-faint focus:border-brand-500"
            />
          </div>

          {/* checklist */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-faint">Checklist</span>
              {subtasks.length > 0 && (
                <span className="text-[11.5px] font-bold text-muted">
                  {done}/{subtasks.length}
                </span>
              )}
            </div>

            {subtasks.length > 0 && (
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${(done / subtasks.length) * 100}%` }}
                />
              </div>
            )}

            <div className="flex flex-col">
              {subtasks.map((s) => (
                <div key={s.id} className="group flex items-center gap-2.5 py-1">
                  <button
                    onClick={() => toggleSubtask(s)}
                    className={`grid size-[18px] shrink-0 place-items-center rounded-[6px] border-[1.5px] transition ${
                      s.done
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-line hover:border-brand-500'
                    }`}
                    aria-label={s.done ? 'Mark not done' : 'Mark done'}
                  >
                    {s.done && <IconCheck size={11} stroke="#fff" />}
                  </button>
                  <span
                    className={`flex-1 text-[13px] ${s.done ? 'text-faint line-through' : 'text-ink-soft'}`}
                  >
                    {s.title}
                  </span>
                  <button
                    onClick={() => removeSubtask(s)}
                    className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                    aria-label="Delete item"
                  >
                    <IconX size={13} />
                  </button>
                </div>
              ))}
            </div>

            <SubtaskInput
              onAdd={async (text) => {
                try {
                  const s = await addSubtask(task.id, text)
                  onTaskChange?.({ subtasks: [...subtasks, s] })
                } catch (e) {
                  showError?.(e, 'Could not add that item')
                }
              }}
            />
          </div>

          {/* comments / activity */}
          <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
            <div className="flex items-center gap-1">
              <Tab active={tab === 'comments'} onClick={() => setTab('comments')}>
                <IconMessage size={13} /> Comments{comments ? ` ${comments.length}` : ''}
              </Tab>
              <Tab active={tab === 'activity'} onClick={() => setTab('activity')}>
                <IconHistory size={13} /> Activity
              </Tab>
            </div>

            {tab === 'comments' ? (
              <>
                {comments === null && <Spinner />}
                {comments?.length === 0 && (
                  <p className="text-[12.5px] text-faint">No comments yet. Start the conversation.</p>
                )}
                {comments?.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar name={c.user.name} size={26} />
                    <div className="min-w-0">
                      <div className="text-[12.5px]">
                        <span className="font-extrabold">{c.user.name}</span>{' '}
                        <span className="text-faint">{ago(c.createdAt)}</span>
                      </div>
                      <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                        {c.content}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <ActivityFeed data={activity} />
            )}
          </div>
        </div>

        {tab === 'comments' && (
          <form onSubmit={postComment} className="shrink-0 border-t border-line-soft px-5 py-3">
            {commentError && (
              <p className="mb-2 text-[11.5px] font-bold text-red-600">{commentError}</p>
            )}
            <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-line px-3 py-2 focus-within:border-brand-500">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a comment…"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white disabled:opacity-40"
              >
                <IconSend size={14} />
              </button>
            </div>
          </form>
        )}

        <div className="shrink-0 border-t border-line-soft px-5 py-3">
          <Button variant="danger" onClick={onDelete} className="h-9">
            <IconTrash size={14} /> Delete task
          </Button>
        </div>
      </aside>
    </div>
  )
}

function Tab({ active, children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-extrabold transition ${
        active ? 'bg-brand-100 text-brand-700' : 'text-faint hover:text-ink-soft'
      }`}
    >
      {children}
    </button>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center">
      <span className="w-24 shrink-0 text-[12.5px] font-bold text-faint">{label}</span>
      {children}
    </div>
  )
}

function SubtaskInput({ onAdd }) {
  const [value, setValue] = useState('')
  const ref = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    const text = value.trim()
    if (!text) return
    setValue('')
    await onAdd(text)
    ref.current?.focus() // stay in the field so a list can be typed straight through
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 pt-1">
      <IconPlus size={13} className="shrink-0 text-faint" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add an item…"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
    </form>
  )
}

function LabelPicker({ all, selected, onToggle, onCreate, onClose }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('violet')
  const boxRef = useRef(null)

  // click-outside, so the popover behaves like every other menu
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const create = async (e) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setName('')
    await onCreate(n, color)
    onClose()
  }

  return (
    <div
      ref={boxRef}
      className="absolute left-0 top-7 z-10 w-60 rounded-xl border border-line bg-surface p-2 shadow-[0_16px_40px_rgba(30,27,46,0.18)]"
    >
      <div className="max-h-44 overflow-y-auto">
        {all.length === 0 && (
          <p className="px-1.5 py-2 text-[12px] text-faint">No labels yet — create the first one.</p>
        )}
        {all.map((l) => {
          const on = selected.some((s) => s.id === l.id)
          return (
            <button
              key={l.id}
              onClick={() => onToggle(l)}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-2"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: labelMeta(l.color).swatch }}
              />
              <span className="flex-1 truncate text-[12.5px] font-semibold">{l.name}</span>
              {on && <IconCheck size={12} className="text-brand-600" />}
            </button>
          )
        })}
      </div>

      <form onSubmit={create} className="mt-1 flex flex-col gap-1.5 border-t border-line-soft pt-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New label…"
          maxLength={30}
          className="w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[12.5px] outline-none focus:border-brand-500"
        />
        <div className="flex items-center gap-1.5">
          {LABEL_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setColor(c.key)}
              aria-label={c.key}
              className={`size-4 rounded-full transition ${
                color === c.key ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface' : ''
              }`}
              style={{ background: c.swatch }}
            />
          ))}
          <button
            type="submit"
            disabled={!name.trim()}
            className="ml-auto rounded-lg bg-brand-600 px-2 py-1 text-[11.5px] font-bold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  )
}

function ActivityFeed({ data }) {
  if (!data) return <Spinner />

  const m = data.metrics || {}
  const stats = [
    ['Cycle time', formatHours(m.cycleTimeHours)],
    ['Lead time', formatHours(m.leadTimeHours)],
    ['Open for', formatHours(m.ageHours)],
    ['In progress', formatHours(m.inProgressHours)],
    ['Due date moved', m.dueMoves ? `${m.dueMoves}×` : null],
  ].filter(([, v]) => v)

  return (
    <div className="flex flex-col gap-3">
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stats.map(([k, v]) => (
            <span
              key={k}
              className="rounded-lg bg-surface-2 px-2 py-1 text-[11.5px] font-semibold text-muted"
            >
              {k} <span className="font-extrabold text-ink-soft">{v}</span>
            </span>
          ))}
        </div>
      )}

      {data.events.length === 0 && <p className="text-[12.5px] text-faint">Nothing recorded yet.</p>}

      <div className="flex flex-col gap-2.5">
        {data.events.map((e) => (
          <div key={e.id} className="flex gap-2.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-200" />
            <div className="min-w-0 text-[12.5px] leading-relaxed">
              <span className="font-extrabold">{e.actor}</span>{' '}
              <span className="text-ink-soft">{e.text}</span>{' '}
              <span className="text-faint">· {ago(e.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
