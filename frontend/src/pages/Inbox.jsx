import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { getNotifications, markAllRead, markRead } from '../lib/api'
import { PageHeader } from '../components/AppLayout'
import {
  EmptyState,
  IconAlert,
  IconAt,
  IconBoard,
  IconCheck,
  IconClock,
  IconMail,
  IconMessage,
  Spinner,
} from '../components/ui'

const TYPES = {
  assigned: { Icon: IconBoard, bg: 'bg-brand-100', fg: 'text-brand-700' },
  mention: { Icon: IconAt, bg: 'bg-pink-100', fg: 'text-pink-600' },
  comment: { Icon: IconMessage, bg: 'bg-blue-100', fg: 'text-blue-600' },
  status: { Icon: IconCheck, bg: 'bg-green-100', fg: 'text-green-600' },
  due: { Icon: IconClock, bg: 'bg-amber-100', fg: 'text-amber-600' },
  overdue: { Icon: IconAlert, bg: 'bg-red-100', fg: 'text-red-600' },
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mentions', label: 'Mentions' },
]

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function Inbox() {
  const navigate = useNavigate()
  const { refreshUnread, showError } = useOutletContext()
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState(null)

  const load = useCallback(() => {
    setItems(null)
    getNotifications(filter)
      .then((d) => setItems(d.notifications))
      .catch(() => setItems([]))
  }, [filter])

  useEffect(load, [load])

  const open = async (n) => {
    if (!n.read) {
      await markRead(n.id).catch(() => {})
      refreshUnread?.()
    }
    if (n.task) navigate(`/workspace/${n.task.workspaceId}?task=${n.task.id}`)
    else if (n.channelId && n.workspaceId) navigate(`/workspace/${n.workspaceId}/chat/${n.channelId}`)
    else if (n.workspaceId) navigate(`/workspace/${n.workspaceId}`)
    else load()
  }

  const clearAll = async () => {
    try {
      await markAllRead()
    } catch (e) {
      showError?.(e, 'Could not mark everything as read')
      return
    }
    refreshUnread?.()
    load()
  }

  return (
    <>
      <PageHeader title="Inbox">
        <button onClick={clearAll} className="text-[12.5px] font-bold text-brand-600 hover:text-brand-700">
          Mark all as read
        </button>
      </PageHeader>

      <div className="flex flex-col gap-4 overflow-y-auto p-7">
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition ${
                filter === f.key ? 'bg-brand-100 text-brand-700' : 'text-muted hover:bg-brand-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex w-full max-w-3xl items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5">
          <IconMail size={16} className="text-brand-600" />
          <span className="text-[12.5px] font-semibold text-ink-soft">
            Reminders and emails are controlled in <b>Settings → Notifications &amp; email</b>.
          </span>
        </div>

        {items === null && <div className="grid place-items-center py-16"><Spinner /></div>}

        {items?.length === 0 && (
          <div className="max-w-3xl">
            <EmptyState
              title="Nothing here"
              hint="You'll get a notification when someone assigns you a task, mentions you in chat, comments on your work, or a due date is coming up."
            />
          </div>
        )}

        <div className="flex max-w-3xl flex-col gap-1">
          {items?.map((n) => {
            const t = TYPES[n.type] || TYPES.status
            return (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={`flex w-full gap-3 rounded-xl px-3.5 py-3 text-left transition hover:bg-brand-50 ${
                  n.read ? '' : 'bg-surface-2'
                }`}
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${t.bg} ${t.fg}`}>
                  <t.Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug text-ink-soft">{n.title}</span>
                  {n.body && <span className="mt-0.5 block truncate text-[12.5px] text-muted">{n.body}</span>}
                  <span className="mt-1 block text-[11px] font-semibold text-faint">{ago(n.createdAt)}</span>
                </span>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" />}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
