import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyTasks } from '../lib/api'
import { formatDue, isSameWeek, workspaceDot } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import { Avatar, EmptyState, PriorityDot, Spinner, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const TILES = [
  { key: 'open', label: 'My open tasks', cls: 'bg-brand-50 text-brand-700' },
  { key: 'week', label: 'Due this week', cls: 'bg-amber-50 text-amber-700' },
  { key: 'overdue', label: 'Overdue', cls: 'bg-red-50 text-red-700' },
  { key: 'done', label: 'Completed', cls: 'bg-green-50 text-green-700' },
]

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState(null)

  useEffect(() => {
    getMyTasks().then(setTasks).catch(() => setTasks([]))
  }, [])

  const counts = useMemo(() => {
    const t = tasks || []
    const open = t.filter((x) => x.status !== 'done')
    return {
      open: open.length,
      week: open.filter((x) => isSameWeek(x.dueDate)).length,
      overdue: open.filter((x) => formatDue(x.dueDate)?.overdue).length,
      done: t.filter((x) => x.status === 'done').length,
    }
  }, [tasks])

  return (
    <>
      <PageHeader title="My Dashboard">
        <Avatar name={user?.name} size={30} />
      </PageHeader>

      <div className="flex flex-col gap-5 overflow-y-auto p-7">
        {tasks === null ? (
          <div className="grid place-items-center py-20">
            <Spinner />
          </div>
        ) : (
          <>
            {/* stat tiles */}
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              {TILES.map((tile) => (
                <div key={tile.key} className={`flex flex-col gap-2 rounded-2xl p-4 ${tile.cls}`}>
                  <span className="text-xs font-bold">{tile.label}</span>
                  <span className="font-display text-[27px] font-extrabold text-ink">
                    {counts[tile.key]}
                  </span>
                </div>
              ))}
            </div>

            {/* assigned to me */}
            <div>
              <h2 className="mb-2.5 text-sm font-bold text-ink-soft">Assigned to me</h2>
              {tasks.length === 0 ? (
                <EmptyState
                  title="Nothing assigned to you yet"
                  hint="Open a workspace and assign yourself a task, or create your first workspace from the sidebar."
                />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-line">
                  <div className="grid grid-cols-[2.4fr_1.1fr_1fr_0.9fr_1fr] gap-3 bg-[#faf8ff] px-4 py-2.5 text-[10px] font-extrabold tracking-wider text-faint">
                    <span>TASK</span>
                    <span>WORKSPACE</span>
                    <span>PRIORITY</span>
                    <span>DUE</span>
                    <span>STATUS</span>
                  </div>
                  {tasks.map((t) => {
                    const due = formatDue(t.dueDate)
                    return (
                      <button
                        key={t.id}
                        onClick={() => navigate(`/workspace/${t.workspace.id}?task=${t.id}`)}
                        className="grid w-full grid-cols-[2.4fr_1.1fr_1fr_0.9fr_1fr] items-center gap-3 border-t border-[#f4f1fc] px-4 py-3 text-left text-[13px] transition hover:bg-brand-50/50"
                      >
                        <span className="truncate font-medium">{t.title}</span>
                        <span className="flex items-center gap-2 text-muted">
                          <span
                            className="size-[7px] shrink-0 rounded-full"
                            style={{ background: workspaceDot(t.workspace.id) }}
                          />
                          <span className="truncate">{t.workspace.name}</span>
                        </span>
                        <PriorityDot value={t.priority} />
                        <span
                          className={`font-semibold ${
                            due?.overdue ? 'text-red-600' : due?.soon ? 'text-amber-600' : 'text-muted'
                          }`}
                        >
                          {due?.label || '—'}
                        </span>
                        <span>
                          <StatusBadge value={t.status} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
