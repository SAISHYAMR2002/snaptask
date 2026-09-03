import { useCallback, useEffect, useState } from 'react'
import { createNote, deleteNote, getNotes, updateNote } from '../lib/api'
import { Button, IconAlert, IconBell, IconPlus, IconTrash, IconX, Spinner } from './ui'

/**
 * Private notes about a person.
 *
 * The privacy claim is the feature, so the UI states it plainly rather than
 * relying on the user to infer it from a lock icon. The server enforces it (see
 * routes/notes.js — every query filters on the author), but a person writing
 * "worried about their workload" needs to *know* that before they type it, not
 * afterwards.
 */
export default function PrivateNotes({ workspaceId, subjectId, subjectName, showError }) {
  const [notes, setNotes] = useState(null)
  const [draft, setDraft] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    getNotes(workspaceId, subjectId).then(setNotes).catch(() => setNotes([]))
  }, [workspaceId, subjectId])

  useEffect(load, [load])

  const add = async (e) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const note = await createNote({
        workspaceId,
        subjectId: subjectId || undefined,
        body,
        remindAt: remindAt ? new Date(remindAt).toISOString() : undefined,
      })
      setNotes((prev) => [note, ...(prev || [])])
      setDraft('')
      setRemindAt('')
      setAdding(false)
    } catch (err) {
      showError?.(err, 'Could not save that note')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    const before = notes
    setNotes((prev) => prev.filter((n) => n.id !== id))
    try {
      await deleteNote(id)
    } catch (err) {
      setNotes(before)
      showError?.(err, 'Could not delete that note')
    }
  }

  const togglePin = async (note) => {
    const before = notes
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)))
    try {
      await updateNote(note.id, { pinned: !note.pinned })
      load()
    } catch (err) {
      setNotes(before)
      showError?.(err, 'Could not update that note')
    }
  }

  return (
    <section className="rounded-2xl border border-line p-4 sm:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-extrabold">
          My private notes{subjectName ? ` on ${subjectName}` : ''}
        </h3>
        {!adding && (
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setAdding(true)}>
            <IconPlus size={13} /> Add note
          </Button>
        )}
      </div>

      {/* Say it in words, before anything is typed. */}
      <p className="mb-3 inline-flex items-start gap-1.5 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[11.5px] font-semibold text-muted">
        <IconAlert size={12} className="mt-0.5 shrink-0" />
        Only you can see these — not {subjectName || 'the person they are about'}, not other admins,
        not the workspace owner.
      </p>

      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
          <textarea
            rows={3}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              subjectName
                ? `e.g. "${subjectName} was blocked on the API all week — check the estimate padding at 1:1"`
                : 'Something to remember…'
            }
            className="resize-none rounded-lg border-[1.5px] border-line bg-surface px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-faint focus:border-brand-500"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11.5px] font-bold text-muted">
              <IconBell size={12} /> Remind me
              <input
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                className="h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12px] font-semibold text-ink-soft outline-none focus:border-brand-500"
              />
            </label>
            <span className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" className="h-8 px-3 text-xs" onClick={() => { setAdding(false); setDraft(''); setRemindAt('') }}>
                Cancel
              </Button>
              <Button type="submit" className="h-8 px-3 text-xs" disabled={busy || !draft.trim()}>
                {busy ? 'Saving…' : 'Save note'}
              </Button>
            </span>
          </div>
        </form>
      )}

      {notes === null && <Spinner />}
      {notes?.length === 0 && !adding && (
        <p className="text-[12.5px] text-faint">
          Nothing yet. Notes are handy before a 1:1 — what to raise, what to follow up, what went well.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {notes?.map((n) => (
          <div key={n.id} className="group flex gap-2.5 rounded-xl border border-line-soft bg-surface-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{n.body}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-bold text-faint">
                <span>{new Date(n.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                {!subjectId && n.subject && <span className="text-brand-700">about {n.subject.name}</span>}
                {n.remindAt && (
                  <span className={`inline-flex items-center gap-1 ${n.remindedAt ? '' : 'text-warn'}`}>
                    <IconBell size={10} />
                    {n.remindedAt ? 'reminded' : `reminds ${new Date(n.remindAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <button
                onClick={() => togglePin(n)}
                title={n.pinned ? 'Unpin' : 'Pin to the top'}
                className={`text-[13px] leading-none ${n.pinned ? 'text-brand-700' : 'text-faint opacity-0 transition group-hover:opacity-100 hover:text-brand-700'}`}
              >
                ★
              </button>
              <button
                onClick={() => remove(n.id)}
                title="Delete"
                className="text-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
              >
                <IconTrash size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
