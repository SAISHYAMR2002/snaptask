import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getWorkspaces, createWorkspace } from '../lib/api'
import { workspaceDot } from '../lib/helpers'
import {
  Avatar,
  Button,
  IconHome,
  IconLogout,
  IconPlus,
  Logo,
  Modal,
  Spinner,
  TextField,
} from './ui'

const navItem = ({ isActive }) =>
  `flex h-9 items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-semibold transition ${
    isActive ? 'bg-brand-100 text-brand-700' : 'text-muted hover:bg-brand-50'
  }`

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [workspaces, setWorkspaces] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(() => {
    getWorkspaces().then(setWorkspaces).catch(() => setWorkspaces([]))
  }, [])
  useEffect(load, [load])

  // Refetch the workspace list whenever we land on a new route
  // (e.g. after creating one, or renaming later).
  useEffect(() => {
    if (workspaces) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  return (
    <div className="flex h-full bg-white">
      {/* ---------------- sidebar ---------------- */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-[#f8f6ff] p-3">
        <div className="px-2.5 pt-1.5 pb-4">
          <Logo />
        </div>

        <nav className="flex flex-col gap-0.5">
          <NavLink to="/" end className={navItem}>
            <IconHome /> My Dashboard
          </NavLink>
        </nav>

        <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
          <span className="text-[10.5px] font-extrabold tracking-wider text-faint">WORKSPACES</span>
          <button
            onClick={() => setShowNew(true)}
            className="text-faint hover:text-brand-600"
            title="New workspace"
          >
            <IconPlus size={13} />
          </button>
        </div>

        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {workspaces === null && (
            <div className="px-3 py-2">
              <Spinner />
            </div>
          )}
          {workspaces?.length === 0 && (
            <p className="px-3 py-1 text-xs text-faint">No workspaces yet</p>
          )}
          {workspaces?.map((w) => (
            <NavLink key={w.id} to={`/workspace/${w.id}`} className={navItem}>
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: workspaceDot(w.id) }}
              />
              <span className="truncate">{w.name}</span>
            </NavLink>
          ))}
        </div>

        {/* profile */}
        <div className="mt-auto flex items-center gap-2.5 rounded-xl border border-line bg-white p-2.5">
          <Avatar name={user?.name} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-bold">{user?.name}</div>
            <div className="text-[10.5px] font-semibold text-faint">{user?.email}</div>
          </div>
          <button
            onClick={() => {
              logout()
              navigate('/login')
            }}
            className="text-faint hover:text-ink"
            title="Log out"
          >
            <IconLogout size={15} />
          </button>
        </div>
      </aside>

      {/* ---------------- page ---------------- */}
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>

      <NewWorkspaceModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(ws) => {
          setShowNew(false)
          load()
          navigate(`/workspace/${ws.id}`)
        }}
      />
    </div>
  )
}

function NewWorkspaceModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setErr('')
    try {
      const ws = await createWorkspace(name.trim())
      setName('')
      onCreated(ws)
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create workspace')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New workspace">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Workspace name"
          placeholder="e.g. Product Team"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// used as the header of every page
export function PageHeader({ title, children }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-7">
      <h1 className="font-display text-[19px] font-extrabold tracking-tight">{title}</h1>
      <div className="flex items-center gap-3">{children}</div>
    </header>
  )
}
