import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { getMessages, sendMessage } from '../lib/api'
import { statusMeta } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import { Avatar, EmptyState, IconHash, IconSend, Spinner } from '../components/ui'

const POLL_MS = 3000

/** Renders message text, highlighting @Name mentions of real members. */
function MessageText({ text, members }) {
  if (!members?.length) return <>{text}</>
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length)
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(@(?:${escaped.join('|')}))`, 'gi')
  return (
    <>
      {text.split(re).map((part, i) =>
        re.test(part) && part.startsWith('@') ? (
          <span key={i} className="rounded bg-brand-100 px-1 font-bold text-brand-700">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export default function Chat() {
  const { channelId } = useParams()
  const { workspace, refreshUnread } = useOutletContext()
  const [messages, setMessages] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const lastAt = useRef(null)

  const channel = workspace?.channels?.find((c) => c.id === channelId)

  // full load when the channel changes
  useEffect(() => {
    setMessages(null)
    lastAt.current = null
    if (!channelId) return
    getMessages(channelId)
      .then((ms) => {
        setMessages(ms)
        lastAt.current = ms.at(-1)?.createdAt || null
      })
      .catch(() => setMessages([]))
  }, [channelId])

  // poll for new messages only (cheap — uses ?after=)
  const poll = useCallback(async () => {
    if (!channelId || !lastAt.current) return
    try {
      const fresh = await getMessages(channelId, lastAt.current)
      if (fresh.length) {
        setMessages((prev) => [...(prev || []), ...fresh])
        lastAt.current = fresh.at(-1).createdAt
        refreshUnread?.()
      }
    } catch { /* keep polling */ }
  }, [channelId, refreshUnread])

  useEffect(() => {
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages?.length])

  const submit = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const msg = await sendMessage(channelId, text)
      setDraft('')
      setMessages((prev) => [...(prev || []), msg])
      lastAt.current = msg.createdAt
    } catch { /* leave the draft so nothing is lost */ } finally {
      setSending(false)
    }
  }

  if (!workspace) {
    return <><PageHeader title="Chat" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  return (
    <>
      <PageHeader
        title={channel ? `#${channel.name}` : 'Chat'}
        subtitle={channel?.purpose || workspace.name}
      >
        <div className="flex items-center">
          {workspace.members.slice(0, 4).map((m, i) => (
            <span key={m.id} className={i ? '-ml-2' : ''}>
              <Avatar name={m.name} size={26} className="ring-2 ring-white" />
            </span>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
          {messages === null && <div className="grid flex-1 place-items-center"><Spinner /></div>}

          {messages?.length === 0 && (
            <div className="grid flex-1 place-items-center">
              <EmptyState
                title={`This is the start of #${channel?.name || 'the channel'}`}
                hint="Say something. Mention a teammate with @ and they get a notification."
              />
            </div>
          )}

          {messages?.map((m) => (
            <div key={m.id} className="flex gap-3">
              <Avatar name={m.user.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">
                  <span className="font-extrabold">{m.user.name}</span>{' '}
                  <span className="text-[11.5px] text-faint">
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                  <MessageText text={m.content} members={workspace.members} />
                </div>

                {m.task && (
                  <div className="mt-2 w-[340px] rounded-xl border border-line bg-[#fdfcff] p-3">
                    <div className="mb-1.5 text-[11px] font-bold text-faint">Linked task</div>
                    <div className="text-[13px] font-bold">{m.task.title}</div>
                    <span
                      className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-[10.5px] font-bold ${statusMeta(m.task.status).chip}`}
                    >
                      {statusMeta(m.task.status).label}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="shrink-0 px-7 pt-3 pb-5">
          <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-white px-4 py-2.5 focus-within:border-brand-500">
            <IconHash size={16} className="shrink-0 text-faint" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message #${channel?.name || ''}   —   use @ to mention someone`}
              className="min-w-0 flex-1 text-sm outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
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
