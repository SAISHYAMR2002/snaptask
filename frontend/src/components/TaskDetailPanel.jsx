import { useEffect, useState } from 'react'
import { PRIORITIES, STATUSES, formatDue } from '../lib/helpers'
import { Avatar, Button, IconTrash, IconX } from './ui'

const fieldSelect =
  'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink-soft outline-none focus:border-brand-500'

export default function TaskDetailPanel({ task, members = [], onPatch, onDelete, onClose }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')

  // keep local fields in sync if the task object is replaced
  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description || '')
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const due = formatDue(task.dueDate)
  const dueValue = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : ''

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onClose}>
      <aside
        className="flex h-full w-[440px] flex-col border-l border-line bg-white shadow-[-16px_0_48px_rgba(30,27,46,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f4f1fc] px-5 py-4">
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
              <select
                value={task.status}
                onChange={(e) => onPatch({ status: e.target.value })}
                className={fieldSelect}
              >
                {STATUSES.map((s) => (
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
                {due?.overdue && (
                  <span className="text-[11px] font-bold text-red-600">Overdue</span>
                )}
              </div>
            </Row>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-faint">Description</span>
            <textarea
              rows={5}
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
        </div>

        <div className="border-t border-[#f4f1fc] px-5 py-3.5">
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
      <span className="w-24 text-[12.5px] font-bold text-faint">{label}</span>
      {children}
    </div>
  )
}
