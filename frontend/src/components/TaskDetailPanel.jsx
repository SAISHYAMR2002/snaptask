import { useEffect, useState } from 'react'
import { addComment, getComments } from '../lib/api'
import { PRIORITIES, STATUSES, formatDue } from '../lib/helpers'
import { Avatar, Button, IconSend, IconTrash, IconX, Spinner } from './ui'

const fieldSelect =
  'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink-soft outline-none focus:border-brand-500'

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export default function TaskDetailPanel({ task, members = [], onPatch, onDelete, onClose }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [comments, setComments] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [commentError, setCommentError] = useState('')

  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description || '')
    setComments(null)
    getComments(task.id).then(setComments).catch(() => setComments([]))
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onClose}>
      <aside
        className="flex h-full w-[460px] flex-col border-l border-line bg-white shadow-[-16px_0_48px_rgba(30,27,46,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#f4f1fc] px-5 py-4">
          <span className="text-xs font-bold tracking-wide text-faint">
            {task.createdBy?.name ? `Created by ${task.createdBy.name}` : 'Task'}
          </span>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <IconX size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && onPatch({ title: title.trim() })}
            className="font-display text-[18px] font-extrabold leading-snug tracking-tight outline-none"
          />

          <div className="flex flex-col gap-3">
            <Row label="Status">
              <select value={task.status} onChange={(e) => onPatch({ status: e.target.value })} className={fieldSelect}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Row>
            <Row label="Priority">
              <select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value })} className={fieldSelect}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
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
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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
              className="resize-none rounded-xl border-[1.5px] border-line bg-[#fdfcff] px-3.5 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-faint focus:border-brand-500"
            />
          </div>

          {/* comments */}
          <div className="flex flex-col gap-3 border-t border-[#f4f1fc] pt-4">
            <span className="text-xs font-extrabold text-faint">
              Comments {comments ? `· ${comments.length}` : ''}
            </span>

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
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{c.content}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={postComment} className="shrink-0 border-t border-[#f4f1fc] px-5 py-3">
          {commentError && (
            <p className="mb-2 text-[11.5px] font-bold text-red-600">{commentError}</p>
          )}
          <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-line px-3 py-2 focus-within:border-brand-500">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              className="min-w-0 flex-1 text-[13px] outline-none placeholder:text-faint"
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

        <div className="shrink-0 border-t border-[#f4f1fc] px-5 py-3">
          <Button variant="danger" onClick={onDelete} className="h-9">
            <IconTrash size={14} /> Delete task
          </Button>
        </div>
      </aside>
    </div>
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
