import { STATUSES, formatDue, formatHours, labelMeta } from '../lib/helpers'
import { Avatar, IconCalendar, IconCheck, IconClock, IconList, PriorityDot } from './ui'

export default function TaskCard({ task, onMove, onOpen, columns, selected, onSelect, selecting }) {
  const raw = formatDue(task.dueDate)
  // a finished task is never "overdue" — don't paint it red
  const due = raw && task.status === 'done' ? { ...raw, overdue: false, soon: false } : raw

  const subtasks = task.subtasks || []
  const doneCount = subtasks.filter((s) => s.done).length
  const estimate = formatHours(task.estimateHours)

  return (
    <div
      onClick={() => (selecting ? onSelect?.(task.id) : onOpen(task.id))}
      className={`flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-surface p-3 shadow-[0_2px_8px_rgba(124,58,237,0.06)] transition ${
        selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-line hover:border-brand-200'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* the checkbox only appears on hover until you start selecting */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(task.id)
          }}
          aria-label={selected ? 'Deselect task' : 'Select task'}
          className={`mt-0.5 grid size-[17px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition ${
            selected
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-line opacity-0 hover:border-brand-500 focus:opacity-100 group-hover/col:opacity-100'
          }`}
        >
          {selected && <IconCheck size={10} stroke="#fff" />}
        </button>

        <div
          className={`flex-1 text-[13.5px] font-medium leading-snug ${
            task.status === 'done' ? 'text-muted line-through' : ''
          }`}
        >
          {task.title}
        </div>
      </div>

      {task.labels?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span
              key={l.id}
              className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${labelMeta(l.color).chip}`}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <PriorityDot value={task.priority} />
        <div className="flex items-center gap-2">
          {due && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                due.overdue
                  ? 'bg-danger-soft text-danger-ink'
                  : due.soon
                    ? 'bg-warn-soft text-warn-ink'
                    : 'bg-surface-3 text-muted'
              }`}
            >
              <IconCalendar size={11} />
              {due.label}
            </span>
          )}
          {task.assignedTo ? (
            <Avatar name={task.assignedTo.name} size={22} />
          ) : (
            <span className="grid size-[22px] place-items-center rounded-[30%] bg-surface-3 text-[11px] font-extrabold text-faint">
              ?
            </span>
          )}
        </div>
      </div>

      {(subtasks.length > 0 || estimate) && (
        <div className="flex items-center gap-3 text-[11px] font-bold text-faint">
          {subtasks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <IconList size={11} />
              {doneCount}/{subtasks.length}
            </span>
          )}
          {estimate && (
            <span className="inline-flex items-center gap-1">
              <IconClock size={11} />
              {estimate}
            </span>
          )}
        </div>
      )}

      <div className="border-t border-line-soft pt-2">
        <select
          value={task.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation()
            // must be a patch OBJECT — the API expects { status }, not a bare string
            onMove(task.id, { status: e.target.value })
          }}
          className="cursor-pointer rounded-md bg-surface-3 px-2 py-1 text-[11px] font-bold text-ink-soft outline-none"
        >
          {(columns?.length ? columns : STATUSES).map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
