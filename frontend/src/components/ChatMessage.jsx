import { useState } from 'react'
import { QUICK_REACTIONS } from '../lib/emoji'
import { statusMeta } from '../lib/helpers'
import { Avatar } from './ui'

/** Highlights @Name mentions of real members inside message text. */
function MessageText({ text, members }) {
  if (!members?.length) return <>{text}</>
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length)
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(@(?:${escaped.join('|')}))`, 'gi')
  return (
    <>
      {text.split(re).map((part, i) =>
        part.startsWith?.('@') && names.some((n) => `@${n}`.toLowerCase() === part.toLowerCase()) ? (
          <span key={i} className="rounded bg-brand-100 px-1 font-bold text-brand-700">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function Poll({ poll, onVote }) {
  return (
    <div className="mt-2 w-[380px] max-w-full rounded-xl border border-line bg-surface-2 p-3.5">
      <div className="mb-0.5 text-[10px] font-extrabold tracking-wider text-faint">
        POLL{poll.multiple ? ' · PICK SEVERAL' : ''}
      </div>
      <div className="mb-3 text-[13.5px] font-bold">{poll.question}</div>

      <div className="flex flex-col gap-1.5">
        {poll.options.map((o) => (
          <button
            key={o.id}
            onClick={() => onVote(poll.id, o.id)}
            title={o.voters.length ? o.voters.join(', ') : 'No votes yet'}
            className={`relative overflow-hidden rounded-lg border px-3 py-2 text-left transition ${
              o.mine ? 'border-brand-200 bg-brand-50' : 'border-line hover:border-brand-200'
            }`}
          >
            {/* result bar sits behind the label */}
            <span
              className="absolute inset-y-0 left-0 bg-brand-100/70 transition-all"
              style={{ width: `${o.pct}%` }}
            />
            <span className="relative flex items-center gap-2">
              <span className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${o.mine ? 'border-brand-600 bg-brand-600' : 'border-line'}`}>
                {o.mine && <span className="size-1.5 rounded-full bg-surface" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{o.text}</span>
              <span className="shrink-0 text-[11.5px] font-extrabold text-muted">{o.pct}%</span>
              <span className="w-5 shrink-0 text-right text-[11px] text-faint">{o.votes}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-2 text-[11px] font-semibold text-faint">
        {poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'} · click again to undo
      </div>
    </div>
  )
}

export default function ChatMessage({ message: m, members, onReact, onVote }) {
  const [showPicker, setShowPicker] = useState(false)

  return (
    <div
      className="group relative flex gap-3"
      onMouseLeave={() => setShowPicker(false)}
    >
      <Avatar name={m.user.name} size={36} />

      <div className="min-w-0 flex-1">
        <div className="text-[13px]">
          <span className="font-extrabold">{m.user.name}</span>{' '}
          <span className="text-[11.5px] text-faint">
            {new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>

        {!m.poll && (
          <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
            <MessageText text={m.content} members={members} />
          </div>
        )}

        {m.poll && <Poll poll={m.poll} onVote={onVote} />}

        {m.task && (
          <div className="mt-2 w-[340px] max-w-full rounded-xl border border-line bg-surface-2 p-3">
            <div className="mb-1.5 text-[11px] font-bold text-faint">Linked task</div>
            <div className="text-[13px] font-bold">{m.task.title}</div>
            <span className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-[10.5px] font-bold ${statusMeta(m.task.status).chip}`}>
              {statusMeta(m.task.status).label}
            </span>
          </div>
        )}

        {/* reactions */}
        {m.reactions?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(m.id, r.emoji)}
                title={r.names.join(', ')}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-bold transition ${
                  r.mine ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line text-muted hover:bg-brand-50'
                }`}
              >
                <span className="text-[13px] leading-none">{r.emoji}</span>
                {r.count}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* hover: quick reaction row */}
      <div className="absolute -top-3 right-0 opacity-0 transition group-hover:opacity-100">
        <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface px-1 py-0.5 shadow-[0_4px_14px_rgba(30,27,46,0.12)]">
          {(showPicker ? QUICK_REACTIONS : QUICK_REACTIONS.slice(0, 3)).map((e) => (
            <button
              key={e}
              onClick={() => onReact(m.id, e)}
              className="rounded-full px-1 py-0.5 text-[15px] leading-none hover:bg-brand-50"
            >
              {e}
            </button>
          ))}
          {!showPicker && (
            <button
              onClick={() => setShowPicker(true)}
              className="px-1.5 text-[13px] font-extrabold text-faint hover:text-brand-600"
              title="More"
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
