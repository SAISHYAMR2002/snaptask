import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { getAnalytics } from '../lib/api'
import { PageHeader } from '../components/AppLayout'
import {
  Avatar, Button, EmptyState, IconAlert, IconCheck, IconClock, IconDownload, Pill, Spinner,
} from '../components/ui'

const STATUS = {
  'on-track': { tone: 'green', label: 'On track', Icon: IconCheck },
  'at-risk': { tone: 'amber', label: 'At risk', Icon: IconAlert },
  behind: { tone: 'red', label: 'Behind', Icon: IconAlert },
}
const BAR = { 'on-track': '#22c55e', 'at-risk': '#f59e0b', behind: '#ef4444' }
const PRESETS = [
  { key: '7d', label: '7 days' },
  { key: '14d', label: '14 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '1y', label: '1 year' },
]

export default function Analytics() {
  const { id } = useParams()
  const { workspace, isAdmin } = useOutletContext()

  const [preset, setPreset] = useState('30d')
  const [sprintId, setSprintId] = useState('')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setData(null); setError('')
    const params = sprintId
      ? { sprintId }
      : custom.from && custom.to
        ? { from: custom.from, to: custom.to }
        : { preset }
    getAnalytics(id, params).then(setData).catch((e) => setError(e.response?.data?.error || 'Could not load analytics'))
  }, [id, preset, sprintId, custom])

  useEffect(load, [load])

  const exportCsv = (scope) => {
    const qs = new URLSearchParams(
      sprintId ? { scope, sprintId } : custom.from && custom.to ? { scope, from: custom.from, to: custom.to } : { scope, preset },
    )
    const token = localStorage.getItem('snaptask_token')
    // fetch with the auth header, then hand the browser a blob to save
    fetch(`${import.meta.env.VITE_API_URL || '/api'}/analytics/${id}/export?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob().then((b) => ({ b, name: (r.headers.get('content-disposition') || '').match(/filename="(.+)"/)?.[1] || `snaptask-${scope}.csv` })))
      .then(({ b, name }) => {
        const url = URL.createObjectURL(b)
        const a = document.createElement('a')
        a.href = url; a.download = name; a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => {})
  }

  if (error || (workspace && !isAdmin)) {
    return (
      <>
        <PageHeader title="Team Analytics" />
        <div className="grid flex-1 place-items-center p-7">
          <EmptyState title="Admins only" hint="Ask the owner to promote you from the Members page." />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Team Analytics" subtitle={workspace?.name} badge={<Pill tone="amber">ADMIN</Pill>}>
        <div className="hidden gap-1.5 sm:flex">
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => exportCsv('members')}>
            <IconDownload size={13} /> Members
          </Button>
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => exportCsv('tasks')}>
            <IconDownload size={13} /> Tasks
          </Button>
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => exportCsv('summary')}>
            <IconDownload size={13} /> Summary
          </Button>
        </div>
      </PageHeader>

      {/* range controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5 sm:px-7">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => { setPreset(p.key); setSprintId(''); setCustom({ from: '', to: '' }) }}
            className={`rounded-full px-3 py-1 text-[12px] font-bold transition ${
              !sprintId && !custom.from && preset === p.key ? 'bg-brand-100 text-brand-700' : 'text-muted hover:bg-brand-50'
            }`}
          >
            {p.label}
          </button>
        ))}

        {data?.sprints?.length > 0 && (
          <select
            value={sprintId}
            onChange={(e) => { setSprintId(e.target.value); setCustom({ from: '', to: '' }) }}
            className="h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12px] font-bold text-ink-soft outline-none"
          >
            <option value="">By sprint…</option>
            {data.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        <div className="flex items-center gap-1.5">
          <input
            type="date" value={custom.from}
            onChange={(e) => { setCustom({ ...custom, from: e.target.value }); setSprintId('') }}
            className="h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12px] font-semibold text-ink-soft outline-none"
          />
          <span className="text-[12px] text-faint">→</span>
          <input
            type="date" value={custom.to}
            onChange={(e) => { setCustom({ ...custom, to: e.target.value }); setSprintId('') }}
            className="h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12px] font-semibold text-ink-soft outline-none"
          />
        </div>

        {data && <span className="ml-auto text-[12px] font-semibold text-faint">{data.range.label}</span>}
      </div>

      {!data ? (
        <div className="grid flex-1 place-items-center"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-7">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Completed" value={data.kpis.completedInRange} suffix={`${data.kpis.hoursCompleted ?? 0}h of work`} />
            <Kpi label="Throughput" value={data.kpis.hoursPerDay ?? 0} suffix="hours / day" />
            <Kpi label="On-time" value={data.kpis.onTimeRate == null ? '—' : `${data.kpis.onTimeRate}%`} suffix={`avg cycle ${data.kpis.avgCycleTimeHours ?? '—'}h`} />
            <Kpi label="Overdue" value={data.kpis.overdueTasks} suffix={`${data.kpis.atRiskMembers} of ${data.kpis.totalMembers} at risk`} tone={data.kpis.overdueTasks ? 'red' : null} />
          </div>

          <div className="flex flex-col gap-4 xl:flex-row">
            <div className="min-w-0 flex-[1.5] rounded-2xl border border-line p-4 sm:p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-extrabold">Burndown</h3>
                <div className="flex items-center gap-3 text-[10.5px] font-bold text-muted">
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-faint" />Ideal</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[3px] w-3.5 rounded bg-brand-600" />Actual</span>
                </div>
              </div>
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-surface-3 px-2.5 py-1 text-[11.5px] font-extrabold text-muted">
                <IconClock size={12} />{data.forecast.message}
              </div>
              <Burndown points={data.burndown} />
            </div>

            <div className="min-w-0 flex-1 rounded-2xl border border-line p-4 sm:p-5">
              <h3 className="mb-3 font-display text-sm font-extrabold">Completed over time</h3>
              <Bars items={data.daily} />
              {data.labels.length > 0 && (
                <>
                  <h3 className="mt-5 mb-2.5 font-display text-sm font-extrabold">By label</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.labels.map((l) => (
                      <span key={l.name} className="rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-ink-soft">
                        {l.name} <span className="text-faint">{l.count}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* leaderboard — scrolls on its own once the team grows */}
          <div>
            <h3 className="mb-2.5 font-display text-sm font-extrabold">
              Member ranking <span className="font-sans text-[11.5px] font-semibold text-faint">output + reliability, penalised for overdue</span>
            </h3>
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="max-h-[420px] overflow-y-auto">
                <div className="min-w-[860px]">
                  <div className="sticky top-0 z-10 grid grid-cols-[40px_1.6fr_1fr_.7fr_.7fr_.7fr_.8fr_.8fr_1fr] gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-[10px] font-extrabold tracking-wider text-faint">
                    <span>#</span><span>MEMBER</span><span>HEALTH</span><span>DONE</span><span>HOURS</span><span>OPEN</span><span>OVERDUE</span><span>ON-TIME</span><span>SCORE</span>
                  </div>
                  {data.members.map((m) => {
                    const s = STATUS[m.status]
                    return (
                      <div key={m.id} className="grid grid-cols-[40px_1.6fr_1fr_.7fr_.7fr_.7fr_.8fr_.8fr_1fr] items-center gap-3 border-t border-line-soft px-4 py-3 text-xs">
                        <span className={`font-display text-[15px] font-extrabold ${m.rank === 1 ? 'text-brand-600' : 'text-faint'}`}>{m.rank}</span>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={m.name} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{m.name}</span>
                            <span className="block text-[10px] font-bold text-faint uppercase">{m.role}</span>
                          </span>
                        </span>
                        <span><Pill tone={s.tone}><s.Icon size={11} />{s.label}</Pill></span>
                        <span className="font-bold">{m.completed}</span>
                        <span className="font-bold">{m.hoursCompleted ?? 0}h</span>
                        <span className="font-bold">{m.open}</span>
                        <span className={`font-bold ${m.overdue ? 'text-red-600' : 'text-faint'}`}>{m.overdue}</span>
                        <span className="font-bold">{m.onTimeRate == null ? '—' : `${m.onTimeRate}%`}</span>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-12 overflow-hidden rounded bg-surface-3">
                            <span className="block h-full" style={{ width: `${m.score}%`, background: BAR[m.status] }} />
                          </span>
                          <span className="font-extrabold text-muted">{m.score}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 sm:hidden">
            <Button variant="ghost" className="h-8 flex-1 text-xs" onClick={() => exportCsv('members')}><IconDownload size={13} /> Members CSV</Button>
            <Button variant="ghost" className="h-8 flex-1 text-xs" onClick={() => exportCsv('summary')}><IconDownload size={13} /> Summary CSV</Button>
          </div>

          <p className="pb-2 text-xs text-faint">
            Estimates cover {data.kpis.estimateCoverage}% of tasks. Velocity uses hours where a task is
            estimated and falls back to task counts where it isn't, so coverage improves accuracy.
          </p>
        </div>
      )}
    </>
  )
}

function Kpi({ label, value, suffix, tone }) {
  return (
    <div className={`flex flex-col gap-1 rounded-2xl border p-4 ${tone === 'red' ? 'border-red-200 bg-red-50' : 'border-line'}`}>
      <span className="text-[11.5px] font-bold text-muted">{label}</span>
      <span className="font-display text-[22px] font-extrabold">{value}</span>
      {suffix && <span className="text-[11px] font-semibold text-faint">{suffix}</span>}
    </div>
  )
}

function Bars({ items }) {
  const max = Math.max(...items.map((d) => d.count), 1)
  const show = items.length > 24 ? items.filter((_, i) => i % Math.ceil(items.length / 24) === 0) : items
  return (
    <div className="flex h-28 items-end gap-1">
      {show.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${d.count} on ${d.date}`}>
          <div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max((d.count / max) * 84, 3)}px` }} />
          {show.length <= 14 && <span className="truncate text-[9.5px] font-bold text-faint">{d.label}</span>}
        </div>
      ))}
    </div>
  )
}

function Burndown({ points }) {
  if (!points?.length) return null
  const W = 620, H = 170, PAD_L = 34, PAD_B = 20, PAD_T = 8
  const max = Math.max(...points.map((p) => Math.max(p.remaining, p.ideal)), 1)
  const x = (i) => PAD_L + (i * (W - PAD_L - 10)) / Math.max(points.length - 1, 1)
  const y = (v) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B)
  const line = (k) => points.map((p, i) => `${x(i)},${y(p[k])}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 170 }}>
      <line x1={PAD_L} y1={y(0)} x2={W - 10} y2={y(0)} stroke="currentColor" className="text-line" strokeWidth="1" />
      <line x1={PAD_L} y1={y(max / 2)} x2={W - 10} y2={y(max / 2)} stroke="currentColor" className="text-line-soft" strokeWidth="1" />
      <text x={PAD_L - 6} y={y(max) + 4} fontSize="9" className="fill-faint" textAnchor="end">{max}</text>
      <text x={PAD_L - 6} y={y(0) + 4} fontSize="9" className="fill-faint" textAnchor="end">0</text>
      <polyline points={line('ideal')} fill="none" stroke="#a5a1b8" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
      <polyline points={line('remaining')} fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points.at(-1).remaining)} r="3.5" fill="#7c3aed" />
      <text x={PAD_L} y={H - 4} fontSize="9" className="fill-faint">{points[0].date.slice(5)}</text>
      <text x={W - 10} y={H - 4} fontSize="9" className="fill-faint" textAnchor="end">{points.at(-1).date.slice(5)}</text>
    </svg>
  )
}
