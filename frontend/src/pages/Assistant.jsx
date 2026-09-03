import { useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { askAssistant, getSuggestions } from '../lib/api'
import { formatDue, priorityMeta, statusMeta } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import { Avatar, IconSend, Logo, Pill, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'

/* ---------- the visual blocks the engine can return ---------- */

function StatsBlock({ items }) {
  const tone = { red: 'bg-danger-soft text-danger-ink', amber: 'bg-warn-soft text-warn-ink', green: 'bg-success-soft text-success-ink' }
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {items.map((s, i) => (
        <div key={i} className={`rounded-xl p-3 ${s.tone ? tone[s.tone] : 'bg-brand-50 text-brand-700'}`}>
          <div className="text-[11px] font-bold">{s.label}</div>
          <div className="font-display text-[19px] font-extrabold text-ink">{s.value}</div>
        </div>
      ))}
    </div>
  )
}

function BarsBlock({ title, items }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="rounded-xl border border-line p-3.5">
      {title && <div className="mb-3 text-[12px] font-extrabold text-ink-soft">{title}</div>}
      <div className="flex flex-col gap-2">
        {items.map((b, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="w-24 shrink-0 truncate text-[11.5px] font-bold text-muted">{b.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(b.value / max) * 100}%` }} />
            </div>
            <span className="w-5 text-right text-[11px] font-extrabold text-ink-soft">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PeopleBlock({ items }) {
  const tone = { red: 'red', amber: 'amber', green: 'green' }
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((p, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2">
          <Avatar name={p.name} size={26} />
          <span className="flex-1 truncate text-[13px] font-bold">{p.name}</span>
          <span className="text-[11.5px] text-faint">{p.detail}</span>
          <Pill tone={tone[p.tone]}>{p.status}</Pill>
        </div>
      ))}
    </div>
  )
}

function TasksBlock({ items }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {items.map((t, i) => {
        const due = formatDue(t.dueDate)
        const overdue = due?.overdue && t.status !== 'done'
        return (
          <div key={t.id} className={`flex items-center gap-3 px-3.5 py-2.5 text-[12.5px] ${i ? 'border-t border-line-soft' : ''}`}>
            <span className="size-[7px] shrink-0 rounded-full" style={{ background: priorityMeta(t.priority).dot }} />
            <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
            {t.assignee && <span className="shrink-0 text-[11.5px] text-faint">{t.assignee}</span>}
            {due && (
              <span className={`shrink-0 text-[11.5px] font-bold ${overdue ? 'text-danger' : 'text-muted'}`}>
                {due.label}
              </span>
            )}
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${statusMeta(t.status).chip}`}>
              {statusMeta(t.status).label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const Block = ({ block }) =>
  block.type === 'stats' ? <StatsBlock {...block} />
  : block.type === 'bars' ? <BarsBlock {...block} />
  : block.type === 'people' ? <PeopleBlock {...block} />
  : block.type === 'tasks' ? <TasksBlock {...block} />
  : null

/** **bold** and newlines, without pulling in a markdown library. */
function RichText({ text }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <p key={i} className={line ? 'mb-1.5 last:mb-0' : 'h-2'}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={j} className="font-extrabold">{part.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </p>
      ))}
    </>
  )
}

/* ---------- the page ---------- */

export default function Assistant() {
  const { id } = useParams()
  const { workspace } = useOutletContext()
  const { user } = useAuth()
  const [turns, setTurns] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const bottom = useRef(null)

  useEffect(() => { getSuggestions().then(setSuggestions).catch(() => {}) }, [])
  useEffect(() => { setTurns([]) }, [id])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns.length, busy])

  const ask = async (question) => {
    const q = question.trim()
    if (!q || busy) return
    setDraft('')
    setTurns((t) => [...t, { role: 'user', text: q }])
    setBusy(true)
    try {
      const res = await askAssistant(id, q)
      setTurns((t) => [...t, { role: 'assistant', text: res.answer, blocks: res.blocks || [] }])
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: e.response?.data?.error || 'I could not answer that one.', blocks: [], error: true }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Assistant" subtitle={workspace?.name} badge={<Pill tone="brand">BETA</Pill>} />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {turns.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <Logo size={34} />
                <div>
                  <h2 className="font-display text-lg font-extrabold">Ask about this workspace</h2>
                  <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">
                    I answer from your real tasks — who's working on what, when things will land,
                    who's slipping. Every number comes from the database, nothing is invented.
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-ink-soft transition hover:border-brand-200 hover:bg-brand-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) =>
              t.role === 'user' ? (
                <div key={i} className="flex justify-end gap-3">
                  <div className="max-w-[75%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-[13.5px] font-medium text-white">
                    {t.text}
                  </div>
                  <Avatar name={user?.name} size={30} />
                </div>
              ) : (
                <div key={i} className="flex gap-3">
                  <span className="grid size-[30px] shrink-0 place-items-center rounded-[30%] bg-linear-to-b from-brand-500 to-brand-600 text-[13px] font-extrabold text-white">
                    S
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className={`text-[13.5px] leading-relaxed ${t.error ? 'text-danger' : 'text-ink-soft'}`}>
                      <RichText text={t.text} />
                    </div>
                    {t.blocks?.map((b, j) => <Block key={j} block={b} />)}
                  </div>
                </div>
              ),
            )}

            {busy && (
              <div className="flex items-center gap-3 text-[13px] text-faint">
                <Spinner /> Looking at your tasks…
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); ask(draft) }}
          className="shrink-0 border-t border-line px-7 py-4"
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border-[1.5px] border-line bg-surface px-4 py-2.5 focus-within:border-brand-500">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about people, deadlines, workload, what's at risk…"
              className="min-w-0 flex-1 text-sm outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-[0_5px_14px_rgba(124,58,237,0.3)] disabled:opacity-40"
            >
              <IconSend size={15} />
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
