import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  addMember,
  createTask,
  deleteTask,
  getTasks,
  getWorkspace,
  updateTask,
} from '../lib/api'
import { STATUSES } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import { Avatar, Button, EmptyState, IconPlus, Modal, Spinner, TextField } from '../components/ui'
import TaskCard from '../components/TaskCard'
import TaskDetailPanel from '../components/TaskDetailPanel'
import NewTaskModal from '../components/NewTaskModal'

export default function Board() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const [workspace, setWorkspace] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  const selectedId = searchParams.get('task')
  const selectedTask = useMemo(
    () => (tasks || []).find((t) => t.id === selectedId) || null,
    [tasks, selectedId],
  )

  const load = useCallback(() => {
    setWorkspace(null)
    setTasks(null)
    setError('')
    Promise.all([getWorkspace(id), getTasks(id)])
      .then(([ws, ts]) => {
        setWorkspace(ws)
        setTasks(ts)
      })
      .catch((e) => setError(e.response?.data?.error || 'Could not load this workspace'))
  }, [id])

  useEffect(load, [load])

  const openTask = (taskId) => setSearchParams({ task: taskId }, { replace: false })
  const closeTask = () => setSearchParams({}, { replace: false })

  const patchTask = async (taskId, patch) => {
    const updated = await updateTask(taskId, patch)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)))
  }

  const removeTask = async (taskId) => {
    await deleteTask(taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    closeTask()
  }

  const addTask = async (data) => {
    const task = await createTask({ ...data, workspaceId: id })
    setTasks((prev) => [task, ...prev])
  }

  const grouped = useMemo(() => {
    const g = { todo: [], 'in-progress': [], done: [] }
    for (const t of tasks || []) (g[t.status] || g.todo).push(t)
    return g
  }, [tasks])

  if (error) {
    return (
      <>
        <PageHeader title="Workspace" />
        <div className="p-7">
          <EmptyState title={error} hint="It may have been deleted, or you're not a member." />
        </div>
      </>
    )
  }

  if (!workspace || !tasks) {
    return (
      <>
        <PageHeader title="Loading…" />
        <div className="grid flex-1 place-items-center">
          <Spinner />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title={workspace.name}>
        <div className="flex items-center">
          {workspace.members.map((m, i) => (
            <span key={m.id} className={i ? '-ml-2' : ''}>
              <Avatar name={m.name} size={28} className="ring-2 ring-white" />
            </span>
          ))}
        </div>
        <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setShowInvite(true)}>
          Invite
        </Button>
        <Button className="h-9" onClick={() => setShowNewTask(true)}>
          <IconPlus size={14} /> New task
        </Button>
      </PageHeader>

      {tasks.length === 0 ? (
        <div className="grid flex-1 place-items-center bg-[#fdfcff] p-7">
          <EmptyState
            title="No tasks yet"
            hint="Create the first task for this workspace."
            action={
              <Button onClick={() => setShowNewTask(true)}>
                <IconPlus size={14} /> New task
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-x-auto bg-[#fdfcff] p-7">
          {STATUSES.map((col) => (
            <div key={col.key} className="flex w-full min-w-[260px] flex-1 flex-col gap-2.5">
              <div className="flex items-center gap-2 px-0.5 pb-0.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: col.dot }} />
                <span className="text-[13px] font-extrabold">{col.label}</span>
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-md bg-brand-100 px-1 text-[11px] font-extrabold text-brand-700">
                  {grouped[col.key].length}
                </span>
              </div>

              {grouped[col.key].map((t) => (
                <TaskCard key={t.id} task={t} onMove={patchTask} onOpen={openTask} />
              ))}

              <button
                onClick={() => setShowNewTask(true)}
                className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] font-bold text-faint hover:text-brand-600"
              >
                <IconPlus size={13} /> Add task
              </button>
            </div>
          ))}
        </div>
      )}

      <NewTaskModal
        open={showNewTask}
        onClose={() => setShowNewTask(false)}
        members={workspace.members}
        onCreate={addTask}
      />

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        workspaceId={id}
        onDone={load}
      />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          members={workspace.members}
          onPatch={(patch) => patchTask(selectedTask.id, patch)}
          onDelete={() => removeTask(selectedTask.id)}
          onClose={closeTask}
        />
      )}
    </>
  )
}

function InviteModal({ open, onClose, workspaceId, onDone }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      await addMember(workspaceId, email.trim())
      setEmail('')
      setMsg({ ok: true, text: 'Member added.' })
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || 'Could not add member' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite a member">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Their email"
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-muted">They need a SnapTask account with this email already.</p>
        {msg && (
          <p className={`text-xs font-semibold ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>
            {msg.text}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add member'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
