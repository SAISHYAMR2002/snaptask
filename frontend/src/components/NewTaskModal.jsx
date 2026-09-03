import { useState } from 'react'
import { PRIORITIES } from '../lib/helpers'
import { Button, Modal, TextField } from './ui'

const selectCls =
  'h-11 w-full rounded-xl border-[1.5px] border-line bg-[#fdfcff] px-3 text-sm outline-none focus:border-brand-500'

export default function NewTaskModal({ open, onClose, members = [], onCreate }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    assignedToId: '',
    dueDate: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setBusy(true)
    setErr('')
    try {
      await onCreate({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        assignedToId: form.assignedToId || undefined,
        dueDate: form.dueDate || undefined,
      })
      setForm({ title: '', description: '', priority: 'medium', assignedToId: '', dueDate: '' })
      onClose()
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create task')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New task">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Title"
          placeholder="What needs doing?"
          value={form.title}
          onChange={set('title')}
          autoFocus
        />

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-ink-soft">Description</span>
          <textarea
            rows={3}
            placeholder="Add detail (optional)"
            value={form.description}
            onChange={set('description')}
            className="w-full resize-none rounded-xl border-[1.5px] border-line bg-[#fdfcff] px-3.5 py-2.5 text-sm outline-none placeholder:text-faint focus:border-brand-500"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-ink-soft">Priority</span>
            <select value={form.priority} onChange={set('priority')} className={selectCls}>
              {PRIORITIES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-ink-soft">Assignee</span>
            <select value={form.assignedToId} onChange={set('assignedToId')} className={selectCls}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <TextField label="Due date" type="date" value={form.dueDate} onChange={set('dueDate')} />

        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
