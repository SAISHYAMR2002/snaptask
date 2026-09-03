import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { getMyActivity, getMyTasks } from '../lib/api'
import { formatDue, isSameWeek, statusMeta, workspaceDot } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import { Avatar, Button, EmptyState, IconPlus, PriorityDot, Spinner, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { workspaces, openNewWorkspace } = useOutletContext()
  const [tasks, setTasks] = useState(null)
  const [activity, setActivity] = useState([])

  useEffect(() => {
    getMyTasks().then(setTasks).catch(() => setTasks([]))
    getMyActivity().then(setActivity).catch(() => setActivity([]))
  }, [])

  const stats = useMemo(() => {
    const t = tasks || []
    const open = t.filter((x) => x.status !== 'done')
    const done = t.filter((x) => x.status === 'done')

    // completions per day, last 7 days
    const today = startOfDay(new Date())
    const weekly = []
    for (let i = 6; i >= 0; i--) {
      const day = new Date(today.getTime() - i * DAY)
      const end = new Date(day.getTime() + DAY)
      weekly.push({
        label: day.toLocaleDateString('en-US', { weekday: 'short' }),
        count: done.filter((x) => x.completedAt && new Date(x.completedAt) >= day && new Date(x.completedAt) < end).length,
        isToday: i === 0,
      })
    }

    return {
      open: open.length,
      week: open.filter((x) => isSameWeek(x.dueDate)).length,
      overdue: open.filter((x) => formatDue(x.dueDate)?.overdue).length,
      done: done.length,
      pct: t.length ? Math.round((done.length / t.length) * 100) : 0,
      weekly,
      weekTotal: weekly.reduce((s, d) => s + d.count, 0),
    }
  }, [tasks])

  // brand new account: nothing exists yet -> guide them instead of showing a blank page
  if (workspaces?.length === 0) {
    return (
      <>
        <PageHeader title="My Dashboard" />
        <div className="grid flex-1 place-items-center p-7">
          <div className="max-w-md text-center">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">
              Welcome, {user?.name?.split(' ')[0]}
            </h2>
            <p className="mt-2 mb-6 text-sm leading-relaxed text-muted">
              Start by creating a workspace — it gives you a task board, chat channels and a members
              list. You'll be its <b>owner</b>, so you can invite people and promote them to admin.
            </p>
            <Button onClick={openNewWorkspace} className="h-11 px-6">
              <IconPlus size={15} /> Create your first workspace
            </Button>
          </div>
        </div>
      </>
    )
  }

  if (tasks === null || workspaces === null) {
    return <><PageHeader title="My Dashboard" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  const maxWeekly = Math.max(...stats.weekly.map((d) => d.count), 1)

  return (
    <>
      <PageHeader title="My Dashboard">
        <Avatar name={user?.name} size={30} />
      </PageHeader>

      <div className="flex flex-col gap-4 overflow-y-auto p-7">
        {/* stat tiles */}
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Tile label="My open tasks" value={stats.open} cls="bg-brand-50 text-brand-700" />
          <Tile label="Due this week" value={stats.week} cls="bg-amber-50 text-amber-700" />
          <Tile label="Overdue" value={stats.overdue} cls="bg-red-50 text-red-700" />
          <Tile label="Completed" value={stats.done} cls="bg-green-50 text-green-700" />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* weekly chart */}
          <div className="min-w-0 flex-[1.4] rounded-2xl border border-line p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-sm font-extrabold">Tasks you completed this week</h3>
              <span className="text-xs font-bold text-muted">{stats.weekTotal} total</span>
            </div>
            <div className="mt-5 flex h-32 items-end gap-3">
              {stats.weekly.map((d, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className={`w-full max-w-8 rounded-t-md ${d.isToday ? 'bg-brand-600' : 'bg-brand-500/45'}`}
                    style={{ height: `${Math.max((d.count / maxWeekly) * 96, 4)}px` }}
                    title={`${d.count} completed`}
                  />
                  <span className={`text-[10.5px] font-bold ${d.isToday ? 'text-brand-700' : 'text-faint'}`}>
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* progress ring */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 rounded-2xl border border-line p-5">
            <h3 className="self-start font-display text-sm font-extrabold">Overall progress</h3>
            <Ring pct={stats.pct} done={stats.done} total={(tasks || []).length} />
          </div>
        </div>

        {/* assigned to me */}
        <div>
          <h2 className="mb-2.5 text-sm font-bold text-ink-soft">Assigned to me</h2>
          {tasks.length === 0 ? (
            <EmptyState
              title="Nothing assigned to you yet"
              hint="Open a workspace, create a task and set yourself as the assignee — it will show up here."
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="grid grid-cols-[2.4fr_1.1fr_1fr_0.9fr_1fr] gap-3 bg-[#faf8ff] px-4 py-2.5 text-[10px] font-extrabold tracking-wider text-faint">
                <span>TASK</span><span>WORKSPACE</span><span>PRIORITY</span><span>DUE</span><span>STATUS</span>
              </div>
              {tasks.map((t) => {
                const raw = formatDue(t.dueDate)
                // a finished task is never "overdue" — don't paint it red
                const due = raw && t.status === 'done' ? { ...raw, overdue: false, soon: false } : raw
                return (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/workspace/${t.workspace.id}?task=${t.id}`)}
                    className="grid w-full grid-cols-[2.4fr_1.1fr_1fr_0.9fr_1fr] items-center gap-3 border-t border-[#f4f1fc] px-4 py-3 text-left text-[13px] transition hover:bg-brand-50/50"
                  >
                    <span className="truncate font-medium">{t.title}</span>
                    <span className="flex min-w-0 items-center gap-2 text-muted">
                      <span className="size-[7px] shrink-0 rounded-full" style={{ background: workspaceDot(t.workspace.id) }} />
                      <span className="truncate">{t.workspace.name}</span>
                    </span>
                    <PriorityDot value={t.priority} />
                    <span className={`font-semibold ${due?.overdue ? 'text-red-600' : due?.soon ? 'text-amber-600' : 'text-muted'}`}>
                      {due?.label || '—'}
                    </span>
                    <span><StatusBadge value={t.status} /></span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* activity */}
        {activity.length > 0 && (
          <div>
            <h2 className="mb-2.5 text-sm font-bold text-ink-soft">Recent activity</h2>
            <div className="flex flex-col gap-1 rounded-2xl border border-line p-2">
              {activity.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/workspace/${t.workspace.id}?task=${t.id}`)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-brand-50/60"
                >
                  <Avatar name={t.assignedTo?.name || t.createdBy?.name || '?'} size={26} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
                    <b>{t.title}</b>
                    <span className="text-muted"> in {t.workspace.name}</span>
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-bold ${statusMeta(t.status).chip}`}>
                    {statusMeta(t.status).label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function Tile({ label, value, cls }) {
  return (
    <div className={`flex flex-col gap-2 rounded-2xl p-4 ${cls}`}>
      <span className="text-xs font-bold">{label}</span>
      <span className="font-display text-[27px] font-extrabold text-ink">{value}</span>
    </div>
  )
}

function Ring({ pct, done, total }) {
  const R = 56
  const C = 2 * Math.PI * R
  return (
    <div className="relative grid size-[150px] place-items-center">
      <svg width="150" height="150" viewBox="0 0 150 150" className="-rotate-90">
        <circle cx="75" cy="75" r={R} fill="none" stroke="#f1edfb" strokeWidth="13" />
        <circle
          cx="75" cy="75" r={R} fill="none" stroke="#7c3aed" strokeWidth="13" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C - (C * pct) / 100}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-[28px] font-extrabold">{pct}%</span>
        <span className="text-[11px] font-bold text-faint">{done} / {total} done</span>
      </div>
    </div>
  )
}
