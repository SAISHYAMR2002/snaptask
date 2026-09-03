import { useState } from 'react'
import { PRIORITIES } from '../lib/helpers'
import { IconTrash, IconX } from './ui'

// currentColor everywhere: the bar flips light/dark with the theme, so a
// hardcoded white would disappear against it in one of them.
const select =
  'h-8 rounded-lg border border-current/25 bg-transparent px-2 text-[12px] font-bold outline-none [&>option]:bg-surface [&>option]:text-ink'

/**
 * Floating bar shown while tasks are selected. Every action here is one
 * request that returns an `undo` payload, so nothing is irreversible.
 */
export default function BulkBar({ count, columns, members, onAction, onClear }) {
  const [busy, setBusy] = useState(false)

  const run = async (action, value) => {
    if (busy) return
    setBusy(true)
    try {
      await onAction(action, value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-inverse px-3 py-2.5 text-inverse-ink shadow-[0_16px_40px_rgba(30,27,46,0.35)]">
        <span className="px-1 text-[13px] font-extrabold">
          {count} selected
        </span>

        <select
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && run('status', e.target.value)}
          className={select}
        >
          <option value="">Move to…</option>
          {columns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && run('priority', e.target.value)}
          className={select}
        >
          <option value="">Priority…</option>
          {PRIORITIES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>

        <select
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && run('assign', e.target.value === '__none' ? null : e.target.value)}
          className={select}
        >
          <option value="">Assign to…</option>
          <option value="__none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          disabled={busy}
          onChange={(e) => run('due', e.target.value || null)}
          className={`${select} px-1.5`}
          title="Set due date"
        />

        <button
          disabled={busy}
          onClick={() => run('delete')}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-2.5 text-[12px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          <IconTrash size={13} /> Delete
        </button>

        <button onClick={onClear} className="ml-1 opacity-70 hover:opacity-100" aria-label="Clear selection">
          <IconX size={15} />
        </button>
      </div>
    </div>
  )
}
