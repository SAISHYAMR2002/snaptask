import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import {
  createPoll,
  getMessages,
  markChannelRead,
  pingTyping,
  sendMessage,
  toggleReaction,
  votePoll,
} from '../lib/api'
import { PageHeader } from '../components/AppLayout'
import { Avatar, Button, EmptyState, IconPlus, Modal, Spinner, TextField } from '../components/ui'
import ChatMessage from '../components/ChatMessage'
import MessageComposer from '../components/MessageComposer'
import { useAuth } from '../context/AuthContext'
import * as realtime from '../lib/realtime'

// Only used when the socket is not connected. See the effects below.
const POLL_MS = 3000

export default function Chat() {
  const { channelId } = useParams()
  const { workspace, refreshUnread, showError, live } = useOutletContext()
  const { user } = useAuth()

  const [messages, setMessages] = useState(null)
  const [typing, setTyping] = useState([])
  const [reads, setReads] = useState([])
  const [showPoll, setShowPoll] = useState(false)
  const bottomRef = useRef(null)
  const lastAt = useRef(null)

  const channel = workspace?.channels?.find((c) => c.id === channelId)

  /** Merge server state for messages we already have (reactions, votes). */
  const mergeUpdated = useCallback((updated) => {
    if (!updated?.length) return
    const byId = new Map(updated.map((m) => [m.id, m]))
    setMessages((prev) => (prev || []).map((m) => byId.get(m.id) || m))
  }, [])

  useEffect(() => {
    setMessages(null)
    setTyping([])
    lastAt.current = null
    if (!channelId) return
    getMessages(channelId)
      .then((d) => {
        setMessages(d.messages)
        setReads(d.reads || [])
        lastAt.current = d.messages.at(-1)?.createdAt || new Date(0).toISOString()
      })
      .catch(() => setMessages([]))
    markChannelRead(channelId).catch(() => {})
  }, [channelId])

  // poll for new messages, reaction/vote changes, and who is typing
  const poll = useCallback(async () => {
    if (!channelId || !lastAt.current) return
    try {
      const d = await getMessages(channelId, lastAt.current)
      if (d.messages.length) {
        setMessages((prev) => [...(prev || []), ...d.messages])
        lastAt.current = d.messages.at(-1).createdAt
        refreshUnread?.()
        markChannelRead(channelId).catch(() => {})
      }
      mergeUpdated(d.updated)
      setTyping(d.typing || [])
      setReads(d.reads || [])
    } catch { /* keep polling */ }
  }, [channelId, refreshUnread, mergeUpdated])

  // Polling is now the FALLBACK, not the mechanism. With the socket connected
  // this interval never runs, which is the whole point: the old behaviour was
  // one request per person every 3 seconds whether or not anything happened.
  useEffect(() => {
    if (live) return
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll, live])

  /* ------------------------- realtime handlers ------------------------- */

  // Reactions and votes are resolved per viewer, and a broadcast frame is the
  // same for everyone — so `mine` has to be recomputed from the id lists the
  // server sends alongside.
  const personalise = useCallback(
    (msg) => ({
      ...msg,
      reactions: (msg.reactions || []).map((r) => ({ ...r, mine: r.userIds?.includes(user?.id) ?? r.mine })),
      poll: msg.poll
        ? {
            ...msg.poll,
            options: msg.poll.options.map((o) => ({ ...o, mine: o.voterIds?.includes(user?.id) ?? o.mine })),
          }
        : null,
    }),
    [user?.id],
  )

  useEffect(
    () =>
      realtime.on('message:new', ({ channelId: id, message }) => {
        if (id !== channelId) return
        setMessages((prev) => {
          if (!prev) return prev
          if (prev.some((m) => m.id === message.id)) return prev // already have it
          return [...prev, personalise(message)]
        })
        lastAt.current = message.createdAt
        refreshUnread?.()
        markChannelRead(channelId).catch(() => {})
      }),
    [channelId, refreshUnread, personalise],
  )

  useEffect(
    () =>
      realtime.on('message:update', ({ channelId: id, message }) => {
        if (id !== channelId) return
        setMessages((prev) => (prev || []).map((m) => (m.id === message.id ? personalise(message) : m)))
      }),
    [channelId, personalise],
  )

  useEffect(
    () =>
      realtime.on('typing', ({ channelId: id, name }) => {
        if (id !== channelId) return
        setTyping((prev) => (prev.includes(name) ? prev : [...prev, name]))
        // The server marker expires after 6s; drop it here on the same clock
        // rather than waiting for a poll that may never come.
        setTimeout(() => setTyping((prev) => prev.filter((n) => n !== name)), 5000)
      }),
    [channelId],
  )

  useEffect(
    () =>
      realtime.on('channel:read', ({ channelId: id, userId, lastReadAt }) => {
        if (id !== channelId) return
        setReads((prev) => {
          const name = workspace?.members?.find((m) => m.id === userId)?.name
          const rest = prev.filter((r) => r.userId !== userId)
          return [...rest, { userId, name, lastReadAt }]
        })
      }),
    [channelId, workspace],
  )

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages?.length])

  const replaceMessage = (msg) =>
    setMessages((prev) => (prev || []).map((m) => (m.id === msg.id ? msg : m)))

  const send = async (text) => {
    try {
      const msg = await sendMessage(channelId, text)
      setMessages((prev) => [...(prev || []), msg])
      lastAt.current = msg.createdAt
    } catch (e) {
      showError?.(e, 'Message not sent')
    }
  }

  const react = async (messageId, emoji) => {
    try {
      replaceMessage(await toggleReaction(messageId, emoji))
    } catch (e) {
      showError?.(e, 'Could not react')
    }
  }

  const vote = async (pollId, optionId) => {
    try {
      replaceMessage(await votePoll(pollId, optionId))
    } catch (e) {
      showError?.(e, 'Could not record your vote')
    }
  }

  // everyone (other than me) whose read marker is at or past the newest message
  const lastMsg = messages?.at(-1)
  const seenBy = lastMsg
    ? reads
        .filter((r) => r.userId !== user?.id && new Date(r.lastReadAt) >= new Date(lastMsg.createdAt))
        .map((r) => r.name)
    : []

  if (!workspace) {
    return <><PageHeader title="Chat" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  return (
    <>
      <PageHeader title={channel ? `#${channel.name}` : 'Chat'} subtitle={channel?.purpose || workspace.name}>
        <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setShowPoll(true)}>
          <IconPlus size={13} /> Poll
        </Button>
        <div className="flex items-center">
          {workspace.members.slice(0, 4).map((m, i) => (
            <span key={m.id} className={i ? '-ml-2' : ''}>
              <Avatar name={m.name} size={26} className="ring-2 ring-surface" />
            </span>
          ))}
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
          {messages === null && <div className="grid flex-1 place-items-center"><Spinner /></div>}

          {messages?.length === 0 && (
            <div className="grid flex-1 place-items-center">
              <EmptyState
                title={`This is the start of #${channel?.name || 'the channel'}`}
                hint="Say something. Type @ to mention a teammate — they get a notification."
              />
            </div>
          )}

          {messages?.map((m) => (
            <ChatMessage key={m.id} message={m} members={workspace.members} onReact={react} onVote={vote} />
          ))}

          {seenBy.length > 0 && (
            <div className="pl-12 text-[11px] font-semibold text-faint">
              Seen by {seenBy.slice(0, 3).join(', ')}
              {seenBy.length > 3 ? ` +${seenBy.length - 3}` : ''}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* typing indicator sits just above the composer */}
        <div className="h-5 shrink-0 px-7 text-[12px] font-semibold text-faint">
          {typing.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span className="size-1 animate-bounce rounded-full bg-faint [animation-delay:0ms]" />
                <span className="size-1 animate-bounce rounded-full bg-faint [animation-delay:150ms]" />
                <span className="size-1 animate-bounce rounded-full bg-faint [animation-delay:300ms]" />
              </span>
              {typing.length === 1 ? `${typing[0]} is typing…` : `${typing.slice(0, 2).join(' and ')} are typing…`}
            </span>
          )}
        </div>

        <MessageComposer
          members={workspace.members}
          channelName={channel?.name}
          onSend={send}
          onTyping={() => pingTyping(channelId).catch(() => {})}
        />
      </div>

      <NewPollModal
        open={showPoll}
        onClose={() => setShowPoll(false)}
        onCreate={async (question, options, multiple) => {
          const msg = await createPoll(channelId, question, options, multiple)
          setMessages((prev) => [...(prev || []), msg])
          lastAt.current = msg.createdAt
        }}
      />
    </>
  )
}

function NewPollModal({ open, onClose, onCreate }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const clean = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim() || clean.length < 2) {
      return setErr('A poll needs a question and at least 2 options')
    }
    setBusy(true)
    setErr('')
    try {
      await onCreate(question.trim(), clean, multiple)
      setQuestion(''); setOptions(['', '']); setMultiple(false)
      onClose()
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create the poll')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New poll">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Question"
          placeholder="Which day works for the demo?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
        />
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-ink-soft">Options</span>
          {options.map((o, i) => (
            <input
              key={i}
              value={o}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Option ${i + 1}`}
              className="h-10 rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-sm outline-none placeholder:text-faint focus:border-brand-500"
            />
          ))}
          {options.length < 10 && (
            <button
              type="button"
              onClick={() => setOptions([...options, ''])}
              className="self-start text-[12.5px] font-bold text-brand-600 hover:text-brand-700"
            >
              + Add option
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
          Let people pick more than one
        </label>
        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create poll'}</Button>
        </div>
      </form>
    </Modal>
  )
}
