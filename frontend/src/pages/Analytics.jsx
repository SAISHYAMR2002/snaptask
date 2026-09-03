import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { getAnalytics } from '../lib/api'
import { PageHeader } from '../components/AppLayout'
import { Avatar, EmptyState, IconAlert, IconCheck, IconClock, Pill, Spinner } from '../components/ui'

const STATUS = {
  'on-track': { tone: 'green', label: 'On track', Icon: IconCheck },
  'at-risk': { tone: 'amber', label: 'At risk', Icon: IconAlert },
  behind: { tone: 'red', label: 'Behind', Icon: IconAlert },
}
const BAR_COLOR = { 'on-track': '#22c55e', 'at-risk': '#f59e0b', behind: '#ef4444' }

export default function Analytics() {
  const { id } = useParams()
  const { workspace, isAdmin } = useOutletContext()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null); setError('')
    getAnalytics(id)
      .then(setData)
      .catch((e) => setError(e.response?.data?.error || 'Could not load analytics'))
  }, [id])

  if (error || (workspace && !isAdmin)) {
    return (
      <>
        <PageHeader title="Team Analytics" />
        <div className="grid flex-1 place-items-center p-7">
          <EmptyState
            title="Admins only"
            hint="Team Analytics is visible to workspace admins and the owner. Ask the owner to promote you from the Members page."
          />
        </div>
      </>
    )
  }

  if (!data) {
    return <><PageHeader title="Team Analytics" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  const { kpis, forecast, burndown, weekly, members } = data
  const late = forecast.daysLate > 0 && !forecast.youngWorkspace
  const maxWorkload = Math.max(...members.map((m) => m.open), 1)
  const maxWeekly = Math.max(...weekly.map((w) => w.count), 1)

  return (
    <>
      <PageHeader
        title="Team Analytics"
        subtitle={workspace?.name}
        badge={<Pill tone="amber">ADMIN ONLY</Pill>}
      />

      <div className="flex flex-col gap-4 overflow-y-auto p-7">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Kpi label="Team throughput" value={kpis.throughput} suffix="tasks / day" />
          <Kpi label="On-time completion" value={`${kpis.onTimeRate}%`} />
          <Kpi
            label="Members at risk"
            value={kpis.atRiskMembers}
            suffix={`of ${kpis.totalMembers} members`}
            tone={kpis.atRiskMembers ? 'amber' : null}
          />
          <Kpi label="Overdue tasks" value={kpis.overdueTasks} tone={kpis.overdueTasks ? 'red' : null} />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* burndown + forecast */}
          <div className="min-w-0 flex-[1.5] rounded-2xl border border-line p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-display text-sm font-extrabold">Burndown &amp; forecast</h3>
              <div className="flex items-center gap-3 text-[10.5px] font-bold text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-faint" />Ideal
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-3.5 rounded bg-brand-600" />Actual
                </span>
              </div>
            </div>

            <div
              className={`mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-extrabold ${
                forecast.youngWorkspace
                  ? 'bg-[#f1edfb] text-muted'
                  : late
                    ? 'bg-red-100 text-red-700'
                    : 'bg-green-100 text-green-700'
              }`}
            >
              {forecast.youngWorkspace ? <IconClock size={12} /> : late ? <IconAlert size={12} /> : <IconCheck size={12} />}
              {forecast.message}
            </div>

            <Burndown points={burndown} />
          </div>

          {/* workload */}
          <div className="min-w-0 flex-1 rounded-2xl border border-line p-5">
            <h3 className="mb-4 font-display text-sm font-extrabold">Workload balance</h3>
            <div className="flex flex-col gap-3">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 truncate text-[11.5px] font-bold text-ink-soft">{m.name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#f4f1fc]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(m.open / maxWorkload) * 100}%`, background: BAR_COLOR[m.status] }}
                    />
                  </div>
                  <span className="w-5 text-right text-[11px] font-extrabold text-ink-soft">{m.open}</span>
                </div>
              ))}
            </div>

            <h3 className="mt-6 mb-3 font-display text-sm font-extrabold">Completed, last 7 days</h3>
            <div className="flex h-24 items-end gap-2">
              {weekly.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className="w-full max-w-7 rounded-t bg-brand-500"
                    style={{ height: `${Math.max((d.count / maxWeekly) * 70, 3)}px` }}
                    title={`${d.count} on ${d.date}`}
                  />
                  <span className="text-[10px] font-bold text-faint">{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* members table */}
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-[1.7fr_1fr_.6fr_.7fr_.8fr_1fr_1.3fr] gap-3 bg-[#faf8ff] px-5 py-2.5 text-[10px] font-extrabold tracking-wider text-faint">
            <span>MEMBER</span><span>STATUS</span><span>OPEN</span><span>OVERDUE</span><span>DONE/14d</span><span>COMPLETION</span><span>FORECAST</span>
          </div>
          {members.map((m) => {
            const s = STATUS[m.status]
            return (
              <div key={m.id} className="grid grid-cols-[1.7fr_1fr_.6fr_.7fr_.8fr_1fr_1.3fr] items-center gap-3 border-t border-[#f4f1fc] px-5 py-3 text-xs">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={m.name} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{m.name}</span>
                    <span className="block text-[10px] font-bold text-faint uppercase">{m.role}</span>
                  </span>
                </span>
                <span><Pill tone={s.tone}><s.Icon size={11} />{s.label}</Pill></span>
                <span className="font-bold">{m.open}</span>
                <span className={`font-bold ${m.overdue ? 'text-red-600' : 'text-faint'}`}>{m.overdue}</span>
                <span className="font-bold">{m.doneRecent}</span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-14 overflow-hidden rounded bg-[#f4f1fc]">
                    <span className="block h-full" style={{ width: `${m.completionRate}%`, background: BAR_COLOR[m.status] }} />
                  </span>
                  <span className="text-[10.5px] font-extrabold text-muted">{m.completionRate}%</span>
                </span>
                <span className={`font-bold ${m.status === 'on-track' ? 'text-green-600' : m.status === 'at-risk' ? 'text-amber-600' : 'text-red-600'}`}>
                  {m.forecast}
                </span>
              </div>
            )
          })}
        </div>

        <p className="pb-2 text-xs text-faint">
          Forecast is a transparent heuristic: each person's completion rate over the last 14 days is
          projected across their open tasks in due-date order. It is not a machine-learning model.
        </p>
      </div>
    </>
  )
}

function Kpi({ label, value, suffix, tone }) {
  const tones = { amber: 'border-amber-200 bg-amber-50', red: 'border-red-200 bg-red-50' }
  return (
    <div className={`flex flex-col gap-1.5 rounded-2xl border p-4 ${tone ? tones[tone] : 'border-line'}`}>
      <span className="text-[11.5px] font-bold text-muted">{label}</span>
      <span className="font-display text-[23px] font-extrabold">{value}</span>
      {suffix && <span className="text-[11px] font-semibold text-faint">{suffix}</span>}
    </div>
  )
}

function Burndown({ points }) {
  const W = 620, H = 170, PAD_L = 34, PAD_B = 22, PAD_T = 8
  const max = Math.max(...points.map((p) => Math.max(p.remaining, p.ideal)), 1)
  const x = (i) => PAD_L + (i * (W - PAD_L - 10)) / Math.max(points.length - 1, 1)
  const y = (v) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B)
  const line = (key) => points.map((p, i) => `${x(i)},${y(p[key])}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 170 }}>
      <line x1={PAD_L} y1={y(0)} x2={W - 10} y2={y(0)} stroke="#ece7fa" strokeWidth="1" />
      <line x1={PAD_L} y1={y(max)} x2={W - 10} y2={y(max)} stroke="#f4f1fc" strokeWidth="1" />
      <line x1={PAD_L} y1={y(max / 2)} x2={W - 10} y2={y(max / 2)} stroke="#f4f1fc" strokeWidth="1" />
      <text x={PAD_L - 6} y={y(max) + 4} fontSize="9" fill="#a5a1b8" textAnchor="end">{max}</text>
      <text x={PAD_L - 6} y={y(0) + 4} fontSize="9" fill="#a5a1b8" textAnchor="end">0</text>
      <polyline points={line('ideal')} fill="none" stroke="#a5a1b8" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
      <polyline points={line('remaining')} fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points.at(-1).remaining)} r="3.5" fill="#7c3aed" />
      <text x={PAD_L} y={H - 6} fontSize="9" fill="#a5a1b8">{points[0]?.date.slice(5)}</text>
      <text x={W - 10} y={H - 6} fontSize="9" fill="#a5a1b8" textAnchor="end">{points.at(-1)?.date.slice(5)}</text>
    </svg>
  )
}
