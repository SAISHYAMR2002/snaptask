import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { getMemberReport } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/AppLayout'
import { TrendColumns, VarianceBars } from '../components/charts'
import PrivateNotes from '../components/PrivateNotes'
import {
  Avatar, Button, EmptyState, IconAlert, IconArrowLeft, IconCheck, IconClock,
  IconDownload, Pill, Spinner,
} from '../components/ui'

const PRESETS = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '1y', label: '1 year' },
]

const TONE = {
  good: { cls: 'border-success-line bg-success-soft text-success-ink', Icon: IconCheck },
  watch: { cls: 'border-warn-line bg-warn-soft text-warn-ink', Icon: IconAlert },
  risk: { cls: 'border-danger-line bg-danger-soft text-danger-ink', Icon: IconAlert },
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * One person's performance.
 *
 * Written for the conversation a manager actually has: what did they get done,
 * is it more or less than everyone else, where is time going, and what should I
 * raise with them. Every figure is paired with the TEAM MEDIAN, because a
 * number on its own invites the wrong conclusion — "40h average cycle time" is
 * either fine or alarming depending entirely on where the rest of the team sits.
 */
export default function MemberReport() {
  const { id, userId } = useParams()
  const { workspace, isAdmin, showError } = useOutletContext()
  const { user } = useAuth()

  const [preset, setPreset] = useState('30d')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const isSelf = user?.id === userId

  const load = useCallback(() => {
    setData(null); setError('')
    getMemberReport(id, userId, { preset })
      .then(setData)
      .catch((e) => setError(e.response?.data?.error || 'Could not load this report'))
  }, [id, userId, preset])

  useEffect(load, [load])

  const exportCsv = () => {
    const token = localStorage.getItem('snaptask_token')
    const qs = new URLSearchParams({ scope: 'tasks', preset, userId })
    fetch(`${import.meta.env.VITE_API_URL || '/api'}/analytics/${id}/export?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b)
        const a = document.createElement('a')
        a.href = url
        a.download = `snaptask-${(data?.member.name || 'member').toLowerCase().replace(/\W+/g, '-')}-tasks.csv`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => {})
  }

  if (error) {
    return (
      <>
        <PageHeader title="Performance" />
        <div className="grid flex-1 place-items-center p-7">
          <EmptyState
            title={error}
            hint={isSelf ? undefined : 'Only admins can look at someone else’s report.'}
            action={<Link to={`/workspace/${id}`}><Button variant="ghost">Back to the board</Button></Link>}
          />
        </div>
      </>
    )
  }

  if (!data) {
    return <><PageHeader title="Performance" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  const m = data.member
  const t = data.teamMedian

  return (
    <>
      <PageHeader
        title={isSelf ? 'My performance' : m.name}
        subtitle={workspace?.name}
        badge={isSelf ? <Pill tone="brand">YOU</Pill> : <Pill tone="gray">{m.role}</Pill>}
      >
        <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={exportCsv}>
          <IconDownload size={13} /> Their tasks
        </Button>
        {isAdmin && (
          <Link to={`/workspace/${id}/analytics`}>
            <Button variant="ghost" className="h-8 px-2.5 text-xs"><IconArrowLeft size={13} /> Team</Button>
          </Link>
        )}
      </PageHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5 sm:px-7">
        <span className="text-[11px] font-extrabold tracking-wide text-faint">SHOWING</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-bold transition ${
              preset === p.key ? 'bg-brand-100 text-brand-700' : 'text-muted hover:bg-brand-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] font-semibold text-faint">
          {fmtDate(data.range.from)} – {fmtDate(data.range.to)}
        </span>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-7">
        {/* who, and the one-line read */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line p-4">
          <Avatar name={m.name} size={52} />
          <div className="min-w-0">
            <h2 className="font-display text-lg font-extrabold">{m.name}</h2>
            <p className="text-[12px] font-semibold text-faint">{m.email}</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="text-[11px] font-bold text-faint">SCORE</div>
              <div className="font-display text-[22px] font-extrabold">
                {m.score}
                <span className="ml-1 text-[12px] font-bold text-faint">vs {t.score} median</span>
              </div>
            </div>
            <Pill tone={m.status === 'on-track' ? 'green' : m.status === 'at-risk' ? 'amber' : 'red'}>
              {m.status === 'on-track' ? 'On track' : m.status === 'at-risk' ? 'At risk' : 'Behind'}
            </Pill>
          </div>
        </div>

        {/* what a manager would actually say out loud */}
        <section>
          <h3 className="mb-2 font-display text-sm font-extrabold">What stands out</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.highlights.map((h, i) => {
              const tone = TONE[h.tone] || TONE.watch
              return (
                <div key={i} className={`flex items-start gap-2 rounded-xl border p-3 text-[12.5px] font-semibold ${tone.cls}`}>
                  <tone.Icon size={14} className="mt-0.5 shrink-0" />
                  <span>{h.text}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* every number against the team median */}
        <section>
          <h3 className="mb-2 font-display text-sm font-extrabold">
            Compared with the team
            <span className="ml-2 font-sans text-[11.5px] font-semibold text-faint">
              median across {t.memberCount} {t.memberCount === 1 ? 'person' : 'people'}
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Compare label="Tasks completed" mine={m.completed} team={t.completed} />
            <Compare label="Hours of work" mine={m.hoursCompleted ?? 0} team={t.hoursCompleted ?? 0} unit="h" />
            <Compare label="Hit the deadline" mine={m.onTimeRate} team={t.onTimeRate} unit="%" />
            <Compare label="Days in progress" mine={hrsToDays(m.avgCycleTimeHours)} team={hrsToDays(t.avgCycleTimeHours)} lowerIsBetter unit="d" />
          </div>
        </section>

        <div className="flex flex-col gap-4 xl:flex-row">
          <section className="min-w-0 flex-1 rounded-2xl border border-line p-4 sm:p-5">
            <h3 className="font-display text-sm font-extrabold">Their output over time</h3>
            <p className="mb-3 text-[11.5px] text-faint">Tasks {m.name.split(' ')[0]} completed on each day of this range.</p>
            <TrendColumns items={data.daily} unit="tasks" />
          </section>

          <section className="min-w-0 flex-1 rounded-2xl border border-line p-4 sm:p-5">
            <h3 className="font-display text-sm font-extrabold">How well they estimate</h3>
            <p className="mb-3 text-[11.5px] text-faint">{data.accuracy.verdict}</p>
            {data.accuracy.measured > 0 ? (
              <>
                <div className="mb-3 flex gap-5">
                  <Stat label="Estimated" value={`${data.accuracy.estimatedHours}h`} />
                  <Stat label="Actually took" value={`${data.accuracy.actualHours}h`} tone={data.accuracy.actualHours > data.accuracy.estimatedHours ? 'over' : null} />
                  <Stat label="Measured on" value={`${data.accuracy.measured} tasks`} />
                </div>
                {data.accuracy.biggestOverruns.length > 0 && (
                  <VarianceBars rows={data.accuracy.biggestOverruns} />
                )}
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-[12px] text-faint">
                Add an estimate to a task and fill in time spent when it is done — then this shows
                whether their planning is realistic.
              </p>
            )}
          </section>
        </div>

        {/* where time is going right now */}
        <div className="flex flex-col gap-4 xl:flex-row">
          <TaskList
            className="flex-1"
            title="Sitting in progress"
            hint="Started but not finished for more than two days — usually the sign of a blocker worth asking about."
            empty="Nothing has been stuck for long. Good."
            rows={data.stalled.map((s) => ({
              id: s.id,
              title: s.title,
              right: `${hrsToDays(s.inProgressHours)}d`,
              tone: s.overdue ? 'red' : 'muted',
              sub: s.overdue ? 'past its due date' : s.status,
            }))}
            workspaceId={id}
          />
          <TaskList
            className="flex-1"
            title="Took the longest"
            hint="Longest from starting to finishing. Long here but on-estimate usually means waiting, not working."
            empty="Nothing finished in this range yet."
            rows={data.slowest.map((s) => ({
              id: s.id,
              title: s.title,
              right: `${hrsToDays(s.cycleTimeHours)}d`,
              tone: 'muted',
              sub: s.estimateHours
                ? `estimated ${s.estimateHours}h${s.actualHours != null ? `, logged ${s.actualHours}h` : ''}`
                : 'no estimate',
            }))}
            workspaceId={id}
          />
        </div>

        {data.labels.length > 0 && (
          <section className="rounded-2xl border border-line p-4 sm:p-5">
            <h3 className="mb-2.5 font-display text-sm font-extrabold">What they worked on</h3>
            <div className="flex flex-wrap gap-1.5">
              {data.labels.map((l) => (
                <span key={l.name} className="rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-ink-soft">
                  {l.name} <span className="text-faint">{l.count}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* private notes — the manager's own, invisible to everyone else */}
        <PrivateNotes
          workspaceId={id}
          subjectId={userId}
          subjectName={isSelf ? null : m.name.split(' ')[0]}
          showError={showError}
        />

        <div className="pb-2" />
      </div>
    </>
  )
}

/* ------------------------------ pieces ------------------------------ */

const hrsToDays = (h) => (h == null ? null : Math.round((h / 24) * 10) / 10)

function Stat({ label, value, tone }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-faint">{label}</div>
      <div className={`font-display text-[17px] font-extrabold ${tone === 'over' ? 'text-danger' : ''}`}>{value}</div>
    </div>
  )
}

/**
 * A figure next to the team's median, with the gap stated in words.
 * "12 · team 8 · 50% above" needs no interpretation; "12" alone does.
 */
function Compare({ label, mine, team, unit = '', lowerIsBetter = false }) {
  const has = mine != null && team != null
  const diff = has && team !== 0 ? Math.round(((mine - team) / team) * 100) : null
  const better = diff == null ? null : lowerIsBetter ? diff < 0 : diff > 0
  const meaningful = diff != null && Math.abs(diff) >= 10

  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line p-4">
      <span className="text-[11.5px] font-bold text-muted">{label}</span>
      <span className="font-display text-[22px] leading-none font-extrabold">
        {mine == null ? '—' : `${mine}${unit}`}
      </span>
      <span className="text-[11px] font-semibold text-faint">
        team median {team == null ? '—' : `${team}${unit}`}
      </span>
      {meaningful && (
        <span className={`text-[11px] font-extrabold ${better ? 'text-success-ink' : 'text-warn-ink'}`}>
          {Math.abs(diff)}% {diff > 0 ? 'higher' : 'lower'}
        </span>
      )}
    </div>
  )
}

function TaskList({ title, hint, empty, rows, workspaceId, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line p-4 sm:p-5 ${className}`}>
      <h3 className="font-display text-sm font-extrabold">{title}</h3>
      <p className="mb-3 text-[11.5px] text-faint">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-faint">{empty}</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => (
            <Link
              key={r.id}
              to={`/workspace/${workspaceId}?task=${r.id}`}
              className="flex items-center gap-3 border-t border-line-soft py-2 first:border-t-0 hover:text-brand-700"
            >
              <IconClock size={13} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">{r.title}</span>
                <span className="block truncate text-[10.5px] font-bold text-faint">{r.sub}</span>
              </span>
              <span className={`shrink-0 text-[12px] font-extrabold ${r.tone === 'red' ? 'text-danger' : 'text-muted'}`}>
                {r.right}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
