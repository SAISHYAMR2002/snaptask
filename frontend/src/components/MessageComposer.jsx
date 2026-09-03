import { useEffect, useRef, useState } from 'react'
import { EMOJI_GROUPS } from '../lib/emoji'
import { Avatar, IconHash, IconSend } from './ui'

/**
 * Chat composer with @mention autocomplete and an emoji picker.
 *
 * The mention list is driven off the caret position: we look at the text
 * between the last "@" and the caret, and match it against channel members.
 * Enter/Tab/arrow keys are intercepted only while the list is open, so normal
 * typing and sending are untouched.
 */
export default function MessageComposer({ members = [], channelName, onSend, onTyping, disabled }) {
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState(null) // { query, start, index }
  const [showEmoji, setShowEmoji] = useState(false)
  const inputRef = useRef(null)
  const lastTyped = useRef(0)

  const matches = mention
    ? members
        .filter((m) => m.name.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 6)
    : []

  // close the picker when clicking elsewhere
  useEffect(() => {
    if (!showEmoji) return
    const close = () => setShowEmoji(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [showEmoji])

  const detectMention = (value, caret) => {
    const upto = value.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) return setMention(null)
    // only a fresh "@" at a word boundary counts, and it must not span a newline
    const before = at === 0 ? ' ' : upto[at - 1]
    const query = upto.slice(at + 1)
    if (!/\s/.test(before) || /[\n]/.test(query) || query.length > 30) return setMention(null)
    setMention({ query, start: at, index: 0 })
  }

  const change = (e) => {
    const value = e.target.value
    setDraft(value)
    detectMention(value, e.target.selectionStart)

    // tell the server we're typing, at most once every 3 seconds
    if (value && Date.now() - lastTyped.current > 3000) {
      lastTyped.current = Date.now()
      onTyping?.()
    }
  }

  const pick = (member) => {
    const before = draft.slice(0, mention.start)
    const after = draft.slice(inputRef.current.selectionStart)
    const next = `${before}@${member.name} ${after}`
    setDraft(next)
    setMention(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const pos = before.length + member.name.length + 2
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const keyDown = (e) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return setMention({ ...mention, index: (mention.index + 1) % matches.length }) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setMention({ ...mention, index: (mention.index - 1 + matches.length) % matches.length }) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pick(matches[mention.index]) }
      if (e.key === 'Escape') { e.preventDefault(); return setMention(null) }
    }
  }

  const submit = (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || disabled) return
    onSend(text)
    setDraft('')
    setMention(null)
  }

  const insertEmoji = (emoji) => {
    setDraft((d) => d + emoji)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <form onSubmit={submit} className="relative shrink-0 px-7 pt-3 pb-5">
      {/* mention autocomplete */}
      {mention && matches.length > 0 && (
        <div className="absolute bottom-full left-7 z-30 mb-1 w-72 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[0_14px_36px_rgba(30,27,46,0.18)]">
          <div className="px-3 py-1.5 text-[10px] font-extrabold tracking-wider text-faint">
            MEMBERS OF #{channelName}
          </div>
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(m) }}
              onMouseEnter={() => setMention((cur) => ({ ...cur, index: i }))}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${i === mention.index ? 'bg-brand-50' : ''}`}
            >
              <Avatar name={m.name} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{m.name}</span>
                <span className="block truncate text-[11px] text-faint">{m.email}</span>
              </span>
              {i === mention.index && <span className="text-[10px] font-bold text-brand-700">↵</span>}
            </button>
          ))}
        </div>
      )}

      {/* emoji picker */}
      {showEmoji && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full right-7 z-30 mb-1 w-80 rounded-xl border border-line bg-surface p-2 shadow-[0_14px_36px_rgba(30,27,46,0.18)]"
        >
          <div className="max-h-64 overflow-y-auto">
            {EMOJI_GROUPS.map((g) => (
              <div key={g.name} className="mb-2">
                <div className="px-1 pb-1 text-[10px] font-extrabold tracking-wider text-faint">
                  {g.name.toUpperCase()}
                </div>
                <div className="grid grid-cols-8 gap-0.5">
                  {g.emoji.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => insertEmoji(e)}
                      className="rounded-lg py-1 text-lg leading-none hover:bg-brand-50"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-surface px-4 py-2.5 focus-within:border-brand-500">
        <IconHash size={16} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={draft}
          onChange={change}
          onKeyDown={keyDown}
          placeholder={`Message #${channelName || ''}   —   type @ to mention someone`}
          className="min-w-0 flex-1 text-sm outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowEmoji((s) => !s) }}
          className={`shrink-0 rounded-lg px-1.5 text-lg leading-none transition ${showEmoji ? 'bg-brand-50' : 'hover:bg-brand-50'}`}
          title="Emoji"
        >
          🙂
        </button>
        <button
          type="submit"
          disabled={!draft.trim() || disabled}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-[0_5px_14px_rgba(124,58,237,0.3)] disabled:opacity-40"
        >
          <IconSend size={15} />
        </button>
      </div>
    </form>
  )
}
