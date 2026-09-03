import { formatDue } from '../lib/helpers'
import { STATUSES } from '../lib/helpers'
import { Avatar, IconCalendar, PriorityDot } from './ui'

export default function TaskCard({ task, onMove, onOpen }) {
  const raw = formatDue(task.dueDate)
  // a finished task is never "overdue" — don't paint it red
  const due = raw && task.status === 'done' ? { ...raw, overdue: false, soon: false } : raw

  return (
    <div
      onClick={() => onOpen(task.id)}
      className="flex cursor-pointer flex-col gap-2.5 rounded-xl border border-line bg-white p-3 shadow-[0_2px_8px_rgba(124,58,237,0.06)] transition hover:border-brand-200"
    >
      <div
        className={`text-[13.5px] font-medium leading-snug ${
          task.status === 'done' ? 'text-muted line-through' : ''
        }`}
      >
        {task.title}
      </div>

      <div className="flex items-center justify-between">
        <PriorityDot value={task.priority} />
        <div className="flex items-center gap-2">
          {due && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                due.overdue
                  ? 'bg-red-100 text-red-700'
                  : due.soon
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-[#f1edfb] text-muted'
              }`}
            >
              <IconCalendar size={11} />
              {due.label}
            </span>
          )}
          {task.assignedTo ? (
            <Avatar name={task.assignedTo.name} size={22} />
          ) : (
            <span className="grid size-[22px] place-items-center rounded-[30%] bg-[#f1edfb] text-[11px] font-extrabold text-faint">
              ?
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-[#f4f1fc] pt-2">
        <select
          value={task.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation()
            // must be a patch OBJECT — the API expects { status }, not a bare string
            onMove(task.id, { status: e.target.value })
          }}
          className="cursor-pointer rounded-md bg-[#f4f1fc] px-2 py-1 text-[11px] font-bold text-ink-soft outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
