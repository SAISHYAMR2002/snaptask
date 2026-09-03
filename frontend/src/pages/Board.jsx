import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { bulkTasks, createTask, deleteTask, getTasks, undoBulk, updateTask } from '../lib/api'
import { PRIORITIES, STATUSES } from '../lib/helpers'
import { PageHeader } from '../components/AppLayout'
import {
  Avatar,
  Button,
  EmptyState,
  IconColumns,
  IconPlus,
  IconSearch,
  Spinner,
} from '../components/ui'

const filterCls =
  'h-8 rounded-lg border-[1.5px] border-line bg-surface px-2 text-[12.5px] font-semibold text-ink-soft outline-none focus:border-brand-500'
import TaskCard from '../components/TaskCard'
import TaskDetailPanel from '../components/TaskDetailPanel'
import NewTaskModal from '../components/NewTaskModal'
import BulkBar from '../components/BulkBar'
import ColumnManager from '../components/ColumnManager'

export default function Board() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    workspace,
    workspaceError,
    isAdmin,
    reloadWorkspace,
    refreshUnread,
    showToast,
    showError,
  } = useOutletContext()

  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [selected, setSelected] = useState([])

  // search + filters (the search box is debounced so we don't hit the API per keystroke)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [priority, setPriority] = useState('')
  const [assignee, setAssignee] = useState('')
  const [label, setLabel] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const filtering = Boolean(debounced || priority || assignee || label)

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
    getTasks(id, { q: debounced, priority, assignee, label })
      .then((t) => { if (seq === reqSeq.current) setTasks(t) })
      .catch((e) => {
        if (seq !== reqSeq.current) return
        setError(e.response?.data?.error || 'Could not load this workspace')
      })
  }, [id, debounced, priority, assignee, label])

  useEffect(() => { setTasks(null); setSelected([]) }, [id])
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

  // Local-only merge, for changes the panel has already persisted itself
  // (subtasks) — re-fetching the whole board for a ticked checkbox is wasteful.
  const mergeTask = (taskId, partial) =>
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...partial } : t)))

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

  /* ------------------------------ bulk ------------------------------ */

  const toggleSelect = (taskId) =>
    setSelected((prev) => (prev.includes(taskId) ? prev.filter((x) => x !== taskId) : [...prev, taskId]))

  const runBulk = async (action, value) => {
    const ids = selected
    try {
      const res = await bulkTasks(ids, action, value)
      setSelected([])
      load()
      const verb =
        action === 'delete' ? 'deleted'
        : action === 'assign' ? 'reassigned'
        : action === 'due' ? 'rescheduled'
        : `moved`
      showToast?.(`${res.affected} task${res.affected === 1 ? '' : 's'} ${verb}`, 'info', {
        label: 'Undo',
        onClick: async () => {
          try {
            await undoBulk(res.undo)
            load()
            showToast?.('Reverted')
          } catch (e) {
            showError?.(e, 'Could not undo that')
          }
        },
      })
    } catch (e) {
      showError?.(e, 'Bulk action failed')
    }
  }

  // Columns come from the workspace, not a hardcoded list, so a team can
  // rename or add their own. Falls back to the three defaults if none exist.
  const columns = useMemo(
    () =>
      workspace?.statuses?.length
        ? workspace.statuses
        : STATUSES.map((s, i) => ({ key: s.key, label: s.label, color: s.dot, position: i })),
    [workspace],
  )

  const grouped = useMemo(() => {
    const g = Object.fromEntries(columns.map((c) => [c.key, []]))
    const first = columns[0]?.key
    for (const t of tasks || []) (g[t.status] || g[first])?.push(t)
    return g
  }, [tasks, columns])

  const clearFilters = () => { setSearch(''); setPriority(''); setAssignee(''); setLabel('') }

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
        <Link to={`/workspace/${id}/members`} className="hidden items-center sm:flex" title="Members">
          {workspace.members.slice(0, 4).map((m, i) => (
            <span key={m.id} className={i ? '-ml-2' : ''}>
              <Avatar name={m.name} size={28} className="ring-2 ring-surface" />
            </span>
          ))}
          {workspace.members.length > 4 && (
            <span className="-ml-2 grid size-7 place-items-center rounded-[30%] bg-brand-100 text-[10px] font-extrabold text-brand-700 ring-2 ring-surface">
              +{workspace.members.length - 4}
            </span>
          )}
        </Link>
        {isAdmin && (
          <button
            onClick={() => setShowColumns(true)}
            className="hidden h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] font-bold text-ink-soft hover:bg-brand-50 sm:inline-flex"
            title="Edit board columns"
          >
            <IconColumns size={14} /> Columns
          </button>
        )}
        <Button className="h-9" onClick={() => setShowNewTask(true)}>
          <IconPlus size={14} /> New task
        </Button>
      </PageHeader>

      {/* search + filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5 sm:px-7">
        <div className="flex h-8 w-full max-w-64 items-center gap-2 rounded-lg border-[1.5px] border-line bg-surface px-2.5 focus-within:border-brand-500 sm:w-64">
          <IconSearch size={14} className="shrink-0 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
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
        {workspace.labels?.length > 0 && (
          <select value={label} onChange={(e) => setLabel(e.target.value)} className={filterCls}>
            <option value="">All labels</option>
            {workspace.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {filtering && (
          <button onClick={clearFilters} className="text-[12px] font-bold text-brand-600 hover:text-brand-700">
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
        <div className="grid flex-1 place-items-center bg-surface-2 p-7">
          {filtering ? (
            <EmptyState
              title="No tasks match those filters"
              hint="Try a different search term, or clear the filters."
              action={<Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
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
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden bg-surface-2 px-4 py-5 sm:px-7">
          {columns.map((col) => (
            <div key={col.key} className="group/col flex w-full min-w-[260px] min-h-0 flex-1 flex-col">
              {/* header stays put while the cards below it scroll */}
              <div className="flex shrink-0 items-center gap-2 px-0.5 pb-2.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: col.color || col.dot }} />
                <span className="text-[13px] font-extrabold">{col.label}</span>
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-md bg-brand-100 px-1 text-[11px] font-extrabold text-brand-700">
                  {grouped[col.key].length}
                </span>
              </div>

              <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1 pb-2">
                {grouped[col.key].map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onMove={patchTask}
                    onOpen={openTask}
                    columns={columns}
                    selected={selected.includes(t.id)}
                    onSelect={toggleSelect}
                    selecting={selected.length > 0}
                  />
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

      {selected.length > 0 && (
        <BulkBar
          count={selected.length}
          columns={columns}
          members={workspace.members}
          onAction={runBulk}
          onClear={() => setSelected([])}
        />
      )}

      <NewTaskModal
        open={showNewTask}
        onClose={() => setShowNewTask(false)}
        members={workspace.members}
        onCreate={addTask}
      />

      <ColumnManager
        open={showColumns}
        onClose={() => setShowColumns(false)}
        workspaceId={id}
        statuses={workspace.statuses || []}
        onChanged={async () => { await reloadWorkspace?.(); load() }}
      />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          members={workspace.members}
          columns={columns}
          workspaceLabels={workspace.labels || []}
          onPatch={(patch) => patchTask(selectedTask.id, patch)}
          onTaskChange={(partial) => mergeTask(selectedTask.id, partial)}
          onLabelsChange={reloadWorkspace}
          onDelete={() => removeTask(selectedTask.id)}
          onClose={closeTask}
          showError={showError}
        />
      )}
    </>
  )
}
