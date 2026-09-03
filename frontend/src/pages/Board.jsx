import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { createTask, deleteTask, getTasks, updateTask } from '../lib/api'
import { PRIORITIES, STATUSES } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import { Avatar, Button, EmptyState, IconPlus, IconSearch, Spinner } from '../components/ui'

const filterCls =
  'h-8 rounded-lg border-[1.5px] border-line bg-white px-2 text-[12.5px] font-semibold text-ink-soft outline-none focus:border-brand-500'
import TaskCard from '../components/TaskCard'
import TaskDetailPanel from '../components/TaskDetailPanel'
import NewTaskModal from '../components/NewTaskModal'

export default function Board() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { workspace, workspaceError, reloadWorkspace, refreshUnread, showToast, showError } =
    useOutletContext()

  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)

  // search + filters (the search box is debounced so we don't hit the API per keystroke)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [priority, setPriority] = useState('')
  const [assignee, setAssignee] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const filtering = Boolean(debounced || priority || assignee)

  const selectedId = searchParams.get('task')
  const selectedTask = useMemo(
    () => (tasks || []).find((t) => t.id === selectedId) || null,
    [tasks, selectedId],
  )

  // Sequence guard: switching workspaces or typing fast fires overlapping
  // requests, and a slow earlier one must not overwrite a newer result.
  const reqSeq = useRef(0)
  const load = useCallback(() => {
    const seq = ++reqSeq.current
    setError('')
    getTasks(id, { q: debounced, priority, assignee })
      .then((t) => { if (seq === reqSeq.current) setTasks(t) })
      .catch((e) => {
        if (seq !== reqSeq.current) return
        setError(e.response?.data?.error || 'Could not load this workspace')
      })
  }, [id, debounced, priority, assignee])

  useEffect(() => { setTasks(null) }, [id])
  useEffect(load, [load])

  const openTask = (taskId) => setSearchParams({ task: taskId })
  const closeTask = () => setSearchParams({})

  // Every mutation below is wrapped: a rejected request used to leave the board
  // silently stale, which felt like the app had frozen until you refreshed.
  const patchTask = async (taskId, patch) => {
    const before = tasks
    // optimistic update so the card moves the instant you pick a status
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)))
    try {
      const updated = await updateTask(taskId, patch)
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)))
      refreshUnread?.()
    } catch (e) {
      setTasks(before) // roll back so the UI never lies about what was saved
      showError?.(e, 'Could not update that task')
    }
  }

  const removeTask = async (taskId) => {
    try {
      await deleteTask(taskId)
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      closeTask()
      showToast?.('Task deleted')
    } catch (e) {
      showError?.(e, 'Could not delete that task')
    }
  }

  const addTask = async (data) => {
    // the modal shows its own error, so let it reject after we surface it
    try {
      const task = await createTask({ ...data, workspaceId: id })
      setTasks((prev) => [task, ...prev])
    } catch (e) {
      showError?.(e, 'Could not create that task')
      throw e
    }
  }

  const grouped = useMemo(() => {
    const g = { todo: [], 'in-progress': [], done: [] }
    for (const t of tasks || []) (g[t.status] || g.todo).push(t)
    return g
  }, [tasks])

  // Show a real error with a way out, rather than a spinner that never resolves.
  if (error || workspaceError) {
    return (
      <>
        <PageHeader title="Workspace" />
        <div className="grid flex-1 place-items-center p-7">
          <EmptyState
            title={error || workspaceError}
            hint="It may have been deleted, or you may no longer be a member."
            action={
              <Button onClick={() => { reloadWorkspace?.(); load() }}>Try again</Button>
            }
          />
        </div>
      </>
    )
  }

  if (!workspace || !tasks) {
    return <><PageHeader title="Loading…" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  return (
    <>
      <PageHeader title={workspace.name}>
        <Link to={`/workspace/${id}/members`} className="flex items-center" title="Members">
          {workspace.members.slice(0, 4).map((m, i) => (
            <span key={m.id} className={i ? '-ml-2' : ''}>
              <Avatar name={m.name} size={28} className="ring-2 ring-white" />
            </span>
          ))}
          {workspace.members.length > 4 && (
            <span className="-ml-2 grid size-7 place-items-center rounded-[30%] bg-brand-100 text-[10px] font-extrabold text-brand-700 ring-2 ring-white">
              +{workspace.members.length - 4}
            </span>
          )}
        </Link>
        <Link to={`/workspace/${id}/members`}>
          <Button variant="ghost" className="h-8 px-3 text-xs">Members</Button>
        </Link>
        <Button className="h-9" onClick={() => setShowNewTask(true)}>
          <IconPlus size={14} /> New task
        </Button>
      </PageHeader>

      {/* search + filters */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#f4f1fc] px-7 py-2.5">
        <div className="flex h-8 w-64 items-center gap-2 rounded-lg border-[1.5px] border-line bg-white px-2.5 focus-within:border-brand-500">
          <IconSearch size={14} className="shrink-0 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="min-w-0 flex-1 text-[13px] outline-none placeholder:text-faint"
          />
        </div>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={filterCls}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={filterCls}>
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {workspace.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {filtering && (
          <button
            onClick={() => { setSearch(''); setPriority(''); setAssignee('') }}
            className="text-[12px] font-bold text-brand-600 hover:text-brand-700"
          >
            Clear
          </button>
        )}
        {filtering && tasks && (
          <span className="ml-auto text-[12px] font-semibold text-faint">
            {tasks.length} match{tasks.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="grid flex-1 place-items-center bg-[#fdfcff] p-7">
          {filtering ? (
            <EmptyState
              title="No tasks match those filters"
              hint="Try a different search term, or clear the filters."
              action={
                <Button variant="ghost" onClick={() => { setSearch(''); setPriority(''); setAssignee('') }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No tasks yet"
              hint="Create the first task for this workspace, assign it to someone and give it a due date."
              action={<Button onClick={() => setShowNewTask(true)}><IconPlus size={14} /> New task</Button>}
            />
          )}
        </div>
      ) : (
        // min-h-0 lets the columns shrink so each one scrolls on its own,
        // instead of the whole board scrolling and taking the headers with it
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden bg-[#fdfcff] px-7 py-5">
          {STATUSES.map((col) => (
            <div key={col.key} className="flex w-full min-w-[260px] min-h-0 flex-1 flex-col">
              {/* header stays put while the cards below it scroll */}
              <div className="flex shrink-0 items-center gap-2 px-0.5 pb-2.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: col.dot }} />
                <span className="text-[13px] font-extrabold">{col.label}</span>
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-md bg-brand-100 px-1 text-[11px] font-extrabold text-brand-700">
                  {grouped[col.key].length}
                </span>
              </div>

              <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1 pb-2">
                {grouped[col.key].map((t) => (
                  <TaskCard key={t.id} task={t} onMove={patchTask} onOpen={openTask} />
                ))}

                <button
                  onClick={() => setShowNewTask(true)}
                  className="flex shrink-0 items-center gap-1.5 px-1 py-1.5 text-[12.5px] font-bold text-faint hover:text-brand-600"
                >
                  <IconPlus size={13} /> Add task
                </button>
              </div>
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
