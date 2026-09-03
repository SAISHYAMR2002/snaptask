import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { globalSearch } from '../lib/api'
import { useTheme } from '../context/ThemeContext'
import {
  IconBell,
  IconBoard,
  IconHash,
  IconHome,
  IconMessage,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSun,
  Spinner,
} from './ui'

/**
 * Cmd+K palette: one place to jump anywhere or run a common action.
 *
 * Results come from the Postgres full-text endpoint, so it searches task
 * titles AND descriptions, chat messages and comments - not just what happens
 * to be on screen. The request is debounced and sequence-guarded: typing
 * "board" fires several overlapping searches and the slowest must not be the
 * one that wins.
 */
export default function CommandPalette({ open, onClose, workspaces = [], onNewWorkspace }) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setQ('')
    setResults(null)
    setCursor(0)
    // a frame's delay, otherwise the element is not in the DOM yet to focus
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) { setResults(null); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(() => {
      const mine = ++seq.current
      globalSearch(term)
        .then((r) => { if (mine === seq.current) { setResults(r); setLoading(false) } })
        .catch(() => { if (mine === seq.current) { setResults(null); setLoading(false) } })
    }, 160)
    return () => clearTimeout(t)
  }, [q, open])

  const go = useCallback(
    (path) => { onClose(); navigate(path) },
    [navigate, onClose],
  )

  // One flat list drives both rendering and arrow-key navigation, so the
  // highlighted row and the row Enter activates can never disagree.
  const items = useMemo(() => {
    const out = []
    const term = q.trim().toLowerCase()

    if (results) {
      for (const t of results.tasks) {
        out.push({
          kind: 'Tasks', icon: <IconBoard size={14} />,
          label: t.title,
          meta: [t.workspaceName, t.assigneeName].filter(Boolean).join(' · '),
          run: () => go(`/workspace/${t.workspaceId}?task=${t.id}`),
        })
      }
      for (const m of results.messages) {
        out.push({
          kind: 'Messages', icon: <IconMessage size={14} />,
          label: m.snippet, highlight: true,
          meta: `#${m.channelName} · ${m.authorName}`,
          run: () => go(`/workspace/${m.workspaceId}/chat/${m.channelId}`),
        })
      }
      for (const c of results.comments) {
        out.push({
          kind: 'Comments', icon: <IconMessage size={14} />,
          label: c.snippet, highlight: true,
          meta: `on "${c.taskTitle}" · ${c.authorName}`,
          run: () => go(`/workspace/${c.workspaceId}?task=${c.taskId}`),
        })
      }
      for (const w of results.workspaces) {
        out.push({
          kind: 'Workspaces', icon: <IconBoard size={14} />,
          label: w.name, run: () => go(`/workspace/${w.id}`),
        })
      }
      for (const c of results.channels) {
        out.push({
          kind: 'Channels', icon: <IconHash size={14} />,
          label: `#${c.name}`, run: () => go(`/workspace/${c.workspaceId}/chat/${c.id}`),
        })
      }
    } else {
      // nothing typed yet — offer the workspaces as the fast path
      for (const w of workspaces.slice(0, 5)) {
        out.push({
          kind: 'Workspaces', icon: <IconBoard size={14} />,
          label: w.name, run: () => go(`/workspace/${w.id}`),
        })
      }
    }

    const actions = [
      { label: 'Go to My Dashboard', icon: <IconHome size={14} />, run: () => go('/') },
      { label: 'Go to Inbox', icon: <IconBell size={14} />, run: () => go('/inbox') },
      { label: 'Go to Settings', icon: <IconSettings size={14} />, run: () => go('/settings') },
      { label: 'New workspace', icon: <IconPlus size={14} />, run: () => { onClose(); onNewWorkspace?.() } },
      {
        label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        icon: theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />,
        run: () => { toggle(); onClose() },
      },
    ].filter((a) => !term || a.label.toLowerCase().includes(term))

    for (const a of actions) out.push({ kind: 'Actions', ...a })
    return out
  }, [results, workspaces, q, theme, go, toggle, onClose, onNewWorkspace])

  useEffect(() => { setCursor(0) }, [q, results])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); items[cursor]?.run() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, items, cursor, onClose])

  // keep the highlighted row inside the scroll area
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  let lastKind = null

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-scrim/45 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="flex h-fit max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_70px_rgba(30,27,46,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <IconSearch size={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, messages, people…"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          {loading && <Spinner className="size-4" />}
          <kbd className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold text-faint">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-faint">
              {loading ? 'Searching…' : `Nothing matches “${q}”`}
            </p>
          )}

          {items.map((item, i) => {
            const header = item.kind !== lastKind ? item.kind : null
            lastKind = item.kind
            return (
              <div key={`${item.kind}-${i}`}>
                {header && (
                  <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-extrabold tracking-wider text-faint">
                    {header.toUpperCase()}
                  </div>
                )}
                <button
                  data-active={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={item.run}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                    i === cursor ? 'bg-brand-100 text-brand-700' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className="shrink-0 text-faint">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {item.highlight ? <Snippet text={item.label} /> : item.label}
                    </span>
                    {item.meta && (
                      <span className="block truncate text-[11.5px] text-faint">{item.meta}</span>
                    )}
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line-soft px-4 py-2 text-[11px] font-semibold text-faint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span className="ml-auto">Full-text search across tasks, chat and comments</span>
        </div>
      </div>
    </div>
  )
}

/**
 * ts_headline marks the matched words with << >>. Rendering those as styled
 * spans is what makes a chat result readable — otherwise you get a fragment
 * with no clue which word matched.
 */
function Snippet({ text }) {
  const parts = String(text).split(/(<<[^>]*>>)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('<<') && p.endsWith('>>') ? (
          <mark key={i} className="rounded bg-brand-100 px-0.5 text-brand-700">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}
