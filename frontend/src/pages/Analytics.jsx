import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { getAnalytics } from '../lib/api'
import { PageHeader } from '../components/AppLayout'
import { BurndownChart, TrendColumns, VarianceBars } from '../components/charts'
import {
  Avatar, Button, EmptyState, IconAlert, IconCheck, IconChevronDown, IconClock,
  IconDownload, Pill, Spinner,
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

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

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

  const activeSprint = data?.sprints?.find((s) => s.id === sprintId)

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

      {/* ---------------- range controls ---------------- */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-soft px-4 py-2.5 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold tracking-wide text-faint">SHOWING</span>
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

          <span className="mx-1 h-4 w-px bg-line" />

          <SprintPicker
            sprints={data?.sprints || []}
            value={sprintId}
            onChange={(v) => { setSprintId(v); setCustom({ from: '', to: '' }) }}
          />

          <span className="mx-1 h-4 w-px bg-line" />

          <label className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wide text-faint">
            CUSTOM
            <input
              type="date" value={custom.from} aria-label="From date"
              onChange={(e) => { setCustom({ ...custom, from: e.target.value }); setSprintId('') }}
              className="h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12px] font-semibold text-ink-soft outline-none focus:border-brand-500"
            />
            <span className="text-faint">→</span>
            <input
              type="date" value={custom.to} aria-label="To date"
              onChange={(e) => { setCustom({ ...custom, to: e.target.value }); setSprintId('') }}
              className="h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12px] font-semibold text-ink-soft outline-none focus:border-brand-500"
            />
          </label>
        </div>

        {/* Say in words what the numbers below actually cover. Every figure on
            this page is "work finished inside this window", which is not
            obvious from a date chip alone. */}
        {data && (
          <p className="text-[11.5px] text-faint">
            Everything below counts work <b className="font-bold text-muted">completed between {fmtDate(data.range.from)} and {fmtDate(data.range.to)}</b>
            {' '}({data.range.days} day{data.range.days === 1 ? '' : 's'})
            {activeSprint && ` — the dates of ${activeSprint.name}`}.
            Open and overdue counts are as of today.
          </p>
        )}
      </div>

      {!data ? (
        <div className="grid flex-1 place-items-center"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-7">
          {activeSprint && <SprintBanner sprint={activeSprint} />}

          {/* KPIs — each says what it means, not just what it is */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Work completed"
              value={data.kpis.completedInRange}
              unit="tasks"
              note={`${data.kpis.hoursCompleted ?? 0} hours of estimated work`}
            />
            <Kpi
              label="Pace"
              value={data.kpis.hoursPerDay ?? 0}
              unit="hrs / day"
              note={`about ${data.kpis.throughput ?? 0} tasks a day`}
            />
            <Kpi
              label="Hit the deadline"
              value={data.kpis.onTimeRate == null ? '—' : `${data.kpis.onTimeRate}%`}
              note={
                data.kpis.onTimeRate == null
                  ? 'no dated work finished yet'
                  : `of tasks that had a due date`
              }
            />
            <Kpi
              label="Overdue now"
              value={data.kpis.overdueTasks}
              unit="tasks"
              note={`${data.kpis.atRiskMembers} of ${data.kpis.totalMembers} people need attention`}
              tone={data.kpis.overdueTasks ? 'red' : null}
            />
          </div>

          {/* ---------------- planning accuracy ---------------- */}
          <Panel
            title="Estimated vs actually taken"
            hint="Did the work take as long as the team thought it would?"
          >
            <Accuracy accuracy={data.accuracy} />
          </Panel>

          <div className="flex flex-col gap-4 xl:flex-row">
            <Panel
              className="min-w-0 flex-[1.5]"
              title="Work remaining"
              hint="The solid line is what is actually left; the dashed line is the steady pace that would finish it evenly."
              right={
                <div className="flex items-center gap-3 text-[10.5px] font-bold text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-faint" />Even pace
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: 'var(--color-chart-1)' }} />Actual
                  </span>
                </div>
              }
            >
              <div className="mb-3 inline-flex items-start gap-1.5 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[11.5px] font-bold text-muted">
                <IconClock size={12} className="mt-0.5 shrink-0" />
                {data.forecast.message}
              </div>
              <BurndownChart points={data.burndown} />
            </Panel>

            <Panel
              className="min-w-0 flex-1"
              title="Tasks completed per day"
              hint="Taller means more finished that day. Gaps are days nothing was completed."
            >
              <TrendColumns items={data.daily} unit="tasks" />
              {data.labels.length > 0 && (
                <>
                  <h4 className="mt-5 mb-2.5 text-[11px] font-extrabold tracking-wide text-faint">
                    WHAT THE WORK WAS
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {data.labels.map((l) => (
                      <span key={l.name} className="rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-ink-soft">
                        {l.name} <span className="text-faint">{l.count}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          </div>

          {/* ---------------- leaderboard ---------------- */}
          <div>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2">
              <h3 className="font-display text-sm font-extrabold">How everyone is doing</h3>
              <span className="text-[11.5px] font-semibold text-faint">
                click a row for the full picture · score blends output and reliability, minus a penalty for overdue work
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="max-h-[420px] overflow-y-auto">
                <div className="min-w-[940px]">
                  <div className="sticky top-0 z-10 grid grid-cols-[36px_1.5fr_.9fr_.6fr_.6fr_.6fr_.7fr_.7fr_.9fr_.9fr] gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-[10px] font-extrabold tracking-wider text-faint">
                    <span>#</span><span>PERSON</span><span>HEALTH</span><span>DONE</span><span>HOURS</span>
                    <span>OPEN</span><span>OVERDUE</span><span>ON TIME</span><span>EST. VS REAL</span><span>SCORE</span>
                  </div>
                  {data.members.map((m) => {
                    const s = STATUS[m.status]
                    const acc = m.accuracy
                    return (
                      <Link
                        key={m.id}
                        to={`/workspace/${id}/analytics/${m.id}`}
                        className="grid grid-cols-[36px_1.5fr_.9fr_.6fr_.6fr_.6fr_.7fr_.7fr_.9fr_.9fr] items-center gap-3 border-t border-line-soft px-4 py-3 text-xs transition hover:bg-brand-50"
                      >
                        <span className={`font-display text-[15px] font-extrabold ${m.rank === 1 ? 'text-brand-700' : 'text-faint'}`}>{m.rank}</span>
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
                        <span className={`font-bold ${m.overdue ? 'text-danger' : 'text-faint'}`}>{m.overdue}</span>
                        <span className="font-bold">{m.onTimeRate == null ? '—' : `${m.onTimeRate}%`}</span>
                        <span className="font-bold">
                          {acc?.measured ? <RatioChip ratio={acc.medianRatio} n={acc.measured} /> : <span className="text-faint">—</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-12 overflow-hidden rounded" style={{ background: 'var(--color-chart-track)' }}>
                            <span className="block h-full" style={{ width: `${m.score}%`, background: BAR[m.status] }} />
                          </span>
                          <span className="font-extrabold text-muted">{m.score}</span>
                        </span>
                      </Link>
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
            {data.kpis.estimateCoverage}% of tasks carry an estimate. Pace is measured in hours where a
            task is estimated and falls back to task counts where it is not — the more tasks carry
            estimates, the more accurate every projection on this page becomes.
          </p>
        </div>
      )}
    </>
  )
}

/* ------------------------------ pieces ------------------------------ */

function Panel({ title, hint, right, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-line p-4 sm:p-5 ${className}`}>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-sm font-extrabold">{title}</h3>
        {right}
      </div>
      {hint && <p className="mb-3 max-w-prose text-[11.5px] text-faint">{hint}</p>}
      {children}
    </section>
  )
}

function Kpi({ label, value, unit, note, tone }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-2xl border p-4 ${tone === 'red' ? 'border-danger-line bg-danger-soft' : 'border-line'}`}>
      <span className="text-[11.5px] font-bold text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-[24px] leading-none font-extrabold">{value}</span>
        {unit && <span className="text-[11px] font-bold text-faint">{unit}</span>}
      </span>
      {note && <span className="mt-0.5 text-[11px] font-semibold text-faint">{note}</span>}
    </div>
  )
}

/** 1.7× reads as jargon; "70% over" is what people actually mean. */
function RatioChip({ ratio, n }) {
  if (ratio == null) return <span className="text-faint">—</span>
  const pct = Math.round(Math.abs(ratio - 1) * 100)
  const over = ratio > 1.15
  const under = ratio < 0.85
  return (
    <span
      title={`Median across ${n} completed task${n === 1 ? '' : 's'} that had both an estimate and logged time`}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-extrabold ${
        over ? 'bg-danger-soft text-danger-ink' : under ? 'bg-info-soft text-info-ink' : 'bg-success-soft text-success-ink'
      }`}
    >
      {over ? `${pct}% over` : under ? `${pct}% under` : 'on target'}
    </span>
  )
}

function Accuracy({ accuracy: a }) {
  if (!a.measured) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-center">
        <p className="text-[13px] font-bold text-muted">{a.verdict}</p>
        <p className="mx-auto mt-1 max-w-md text-[11.5px] text-faint">
          Put an <b>Estimate</b> on a task before starting it, then fill in <b>Time spent</b> when it
          is done. Once a few tasks carry both, this panel shows whether the team plans realistically —
          and who needs help sizing work.
        </p>
      </div>
    )
  }

  const total = a.overCount + a.onTargetCount + a.underCount
  const seg = (n) => `${(n / total) * 100}%`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="font-display text-[20px] font-extrabold">{a.verdict}</div>
          <div className="mt-0.5 text-[11.5px] text-faint">
            Based on {a.measured} completed task{a.measured === 1 ? '' : 's'} with both an estimate and
            logged time ({a.coverage}% of the work in this range).
            {a.coverage < 40 && ' Treat it as a hint rather than a finding until coverage improves.'}
          </div>
        </div>
        <div className="ml-auto flex gap-5">
          <Figure label="Estimated" value={`${a.estimatedHours}h`} />
          <Figure label="Actually took" value={`${a.actualHours}h`} tone={a.actualHours > a.estimatedHours ? 'over' : 'under'} />
        </div>
      </div>

      {/* how the tasks split — a part-to-whole, so one stacked bar */}
      <div>
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
          <span style={{ width: seg(a.underCount), background: 'var(--color-chart-under)' }} />
          <span style={{ width: seg(a.onTargetCount), background: 'var(--color-faint)' }} />
          <span style={{ width: seg(a.overCount), background: 'var(--color-chart-over)' }} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: 'var(--color-chart-under)' }} />
            {a.underCount} finished faster
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: 'var(--color-faint)' }} />
            {a.onTargetCount} on target
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: 'var(--color-chart-over)' }} />
            {a.overCount} took longer
          </span>
        </div>
      </div>

      {a.biggestOverruns.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-extrabold tracking-wide text-faint">WHERE THE TIME WENT</h4>
          <VarianceBars rows={a.biggestOverruns} />
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, tone }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-faint">{label}</div>
      <div className={`font-display text-[18px] font-extrabold ${tone === 'over' ? 'text-danger' : ''}`}>{value}</div>
    </div>
  )
}

/**
 * Sprint picker.
 *
 * The old control was a bare `<select>` reading "By sprint…" — it told a reader
 * neither what a sprint is nor anything about the ones listed. This one shows
 * each sprint's dates, how far through it is and how much is done, and says in
 * one line what a sprint means for anyone who has not met the term.
 */
function SprintPicker({ sprints, value, onChange }) {
  const [open, setOpen] = useState(false)
  const selected = sprints.find((s) => s.id === value)

  if (!sprints.length) {
    return (
      <span
        className="text-[11.5px] font-semibold text-faint"
        title="A sprint is a fixed block of time — usually two weeks — that a team plans work into. Create one from the Members page to compare periods."
      >
        No sprints yet
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border-[1.5px] px-2.5 text-[12px] font-bold transition ${
          selected ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-soft hover:border-brand-500'
        }`}
      >
        {selected ? selected.name : 'Pick a sprint'}
        <IconChevronDown size={12} />
      </button>

      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-20 w-80 rounded-xl border border-line bg-surface p-2 shadow-[0_16px_40px_rgba(30,27,46,0.18)]">
            <p className="px-2 pt-1 pb-2 text-[11px] leading-relaxed text-faint">
              A <b className="text-muted">sprint</b> is a fixed block of time a team plans work into —
              usually two weeks. Picking one sets the dates below to that block, so you can compare
              how one period went against another.
            </p>

            {value && (
              <button
                onClick={() => { onChange(''); setOpen(false) }}
                className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-bold text-brand-700 hover:bg-surface-2"
              >
                ← Back to a date range
              </button>
            )}

            <div className="max-h-72 overflow-y-auto">
              {sprints.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { onChange(s.id); setOpen(false) }}
                  className={`flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left transition hover:bg-surface-2 ${
                    s.id === value ? 'bg-brand-50' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-extrabold">{s.name}</span>
                    <Pill tone={s.state === 'active' ? 'green' : s.state === 'upcoming' ? 'blue' : 'gray'}>
                      {s.state === 'active' ? `${s.daysLeft}d left` : s.state === 'upcoming' ? 'upcoming' : 'finished'}
                    </Pill>
                  </span>
                  <span className="text-[11px] font-semibold text-faint">
                    {fmtDate(s.startsAt)} – {fmtDate(s.endsAt)} · {s.doneCount} of {s.taskCount} tasks done
                    {s.estimatedHours ? ` · ${s.estimatedHours}h planned` : ''}
                  </span>
                  <span className="h-1.5 w-full overflow-hidden rounded" style={{ background: 'var(--color-chart-track)' }}>
                    <span
                      className="block h-full rounded"
                      style={{ width: `${s.percentDone}%`, background: 'var(--color-chart-1)' }}
                    />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** When a sprint is selected, lead with how that sprint is actually going. */
function SprintBanner({ sprint: s }) {
  const behind = s.state === 'active' && s.totalDays > 0 && s.percentDone < (s.daysElapsed / s.totalDays) * 100 - 15
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border p-4 ${behind ? 'border-warn-line bg-warn-soft' : 'border-line'}`}>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-extrabold">{s.name}</h3>
          <Pill tone={s.state === 'active' ? 'green' : s.state === 'upcoming' ? 'blue' : 'gray'}>
            {s.state === 'active' ? 'running now' : s.state === 'upcoming' ? 'not started' : 'finished'}
          </Pill>
        </div>
        <p className="mt-0.5 text-[11.5px] font-semibold text-faint">
          {fmtDate(s.startsAt)} – {fmtDate(s.endsAt)}
          {s.state === 'active' && ` · day ${s.daysElapsed} of ${s.totalDays}`}
        </p>
      </div>

      <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-[11.5px] font-bold">
          <span className="text-muted">{s.doneCount} of {s.taskCount} tasks done</span>
          <span className="text-ink-soft">{s.percentDone}%</span>
        </div>
        <span className="relative h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-chart-track)' }}>
          <span className="block h-full rounded-full" style={{ width: `${s.percentDone}%`, background: 'var(--color-chart-1)' }} />
          {/* where the sprint SHOULD be by now, if work landed evenly */}
          {s.state === 'active' && (
            <span
              className="absolute inset-y-0 w-px bg-ink-soft"
              style={{ left: `${(s.daysElapsed / s.totalDays) * 100}%` }}
              title="Where an even pace would have you by today"
            />
          )}
        </span>
        {behind && (
          <span className="text-[11.5px] font-bold text-warn-ink">
            Behind an even pace — {s.taskCount - s.doneCount} task{s.taskCount - s.doneCount === 1 ? '' : 's'} left with {s.daysLeft} day{s.daysLeft === 1 ? '' : 's'} to go.
          </span>
        )}
      </div>
    </div>
  )
}
