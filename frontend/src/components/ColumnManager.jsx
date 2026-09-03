import { useState } from 'react'
import { createStatus, deleteStatus, updateStatus } from '../lib/api'
import { Button, IconPlus, IconTrash, Modal } from './ui'

const SWATCHES = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#db2777', '#64748b']

/**
 * Board column editor. The backend refuses to delete a column that still has
 * tasks in it, and refuses to go below two columns — so the errors it returns
 * are worth showing verbatim rather than a generic message.
 */
export default function ColumnManager({ open, onClose, workspaceId, statuses = [], onChanged }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [color, setColor] = useState(SWATCHES[0])

  const wrap = async (fn) => {
    setErr('')
    setBusy(true)
    try {
      await fn()
      await onChanged()
    } catch (e) {
      setErr(e.response?.data?.error || 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  const add = (e) => {
    e.preventDefault()
    if (!label.trim()) return
    wrap(async () => {
      await createStatus(workspaceId, { label: label.trim(), color })
      setLabel('')
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Board columns">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          Columns are per-workspace. Mark one as <b>done</b> — analytics counts anything in a done
          column as completed work.
        </p>

        <div className="flex flex-col gap-1.5">
          {statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
              <input
                type="color"
                value={s.color || '#7c3aed'}
                onChange={(e) => wrap(() => updateStatus(workspaceId, s.id, { color: e.target.value }))}
                className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Column colour"
              />
              <input
                defaultValue={s.label}
                onBlur={(e) =>
                  e.target.value.trim() !== s.label &&
                  e.target.value.trim() &&
                  wrap(() => updateStatus(workspaceId, s.id, { label: e.target.value.trim() }))
                }
                className="min-w-0 flex-1 bg-transparent text-[13px] font-bold outline-none"
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] font-bold text-muted">
                <input
                  type="checkbox"
                  checked={s.isDone}
                  onChange={(e) => wrap(() => updateStatus(workspaceId, s.id, { isDone: e.target.checked }))}
                  className="accent-brand-600"
                />
                done
              </label>
              <button
                onClick={() => wrap(() => deleteStatus(workspaceId, s.id))}
                disabled={busy}
                className="shrink-0 text-faint hover:text-danger disabled:opacity-40"
                aria-label={`Delete ${s.label}`}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={add} className="flex items-center gap-2 border-t border-line-soft pt-3">
          <div className="flex shrink-0 gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={`size-4 rounded-full transition ${
                  color === c ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface' : ''
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="New column…"
            className="h-9 min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-surface-2 px-2.5 text-[13px] outline-none focus:border-brand-500"
          />
          <Button type="submit" disabled={busy || !label.trim()} className="h-9 shrink-0 px-3">
            <IconPlus size={13} /> Add
          </Button>
        </form>

        {err && <p className="text-xs font-bold text-danger">{err}</p>}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
