import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useMatch, useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import {
  getWorkspaces,
  getWorkspace,
  createWorkspace,
  getUnreadCount,
  createChannel,
  resendVerification,
} from '../lib/api'
import { workspaceDot } from '../lib/helpers'
import {
  Avatar,
  Button,
  IconBell,
  IconBoard,
  IconChart,
  IconHash,
  IconHome,
  IconLogout,
  IconMail,
  IconMenu,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSparkle,
  IconSun,
  IconUsers,
  Logo,
  Modal,
  Pill,
  Spinner,
  TextField,
  Toast,
} from './ui'

const navItem = ({ isActive }) =>
  `flex h-9 items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-semibold transition ${
    isActive ? 'bg-brand-100 text-brand-700' : 'text-muted hover:bg-brand-50'
  }`

const subItem = ({ isActive }) =>
  `flex h-8 items-center gap-2.5 rounded-[9px] px-3 text-[13px] font-semibold transition ${
    isActive ? 'bg-brand-100 text-brand-700' : 'text-ink-soft hover:bg-brand-50'
  }`

const SectionLabel = ({ children, action }) => (
  <div className="flex items-center justify-between px-3 pt-4 pb-1.5">
    <span className="text-[10.5px] font-extrabold tracking-wider text-faint">{children}</span>
    {action}
  </div>
)

export default function AppLayout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()

  // Which workspace (if any) the current URL is inside.
  // Both useMatch calls MUST run on every render — `a() || b()` would
  // short-circuit the second hook and change the hook count between renders,
  // which crashes the component ("Should have a queue") and freezes the page.
  const nestedMatch = useMatch('/workspace/:id/*')
  const exactMatch = useMatch('/workspace/:id')
  const activeId = nestedMatch?.params?.id || exactMatch?.params?.id || null

  const [workspaces, setWorkspaces] = useState(null)
  const [detail, setDetail] = useState(null) // { workspace, myRole } for activeId
  const [detailError, setDetailError] = useState('')
  const [unread, setUnread] = useState(0)
  const [showNewWs, setShowNewWs] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, tone = 'info') => setToast({ message, tone }), [])
  const showError = useCallback(
    (err, fallback = 'Something went wrong') =>
      setToast({ message: err?.response?.data?.error || err?.message || fallback, tone: 'error' }),
    [],
  )

  const loadWorkspaces = useCallback(
    () => getWorkspaces().then(setWorkspaces).catch(() => setWorkspaces([])),
    [],
  )

  // Guards against a slow response for a workspace you have already navigated
  // away from landing late and overwriting the current one.
  const detailReq = useRef(0)
  const loadDetail = useCallback(() => {
    if (!activeId) { setDetail(null); setDetailError(''); return }
    const seq = ++detailReq.current
    setDetailError('')
    return getWorkspace(activeId)
      .then((d) => { if (seq === detailReq.current) setDetail(d) })
      .catch((e) => {
        if (seq !== detailReq.current) return
        setDetail(null)
        // an error state beats an spinner that never resolves
        setDetailError(e.response?.data?.error || 'Could not load this workspace')
      })
  }, [activeId])

  const refreshUnread = useCallback(() => getUnreadCount().then(setUnread).catch(() => {}), [])

  useEffect(() => { loadWorkspaces() }, [loadWorkspaces])
  useEffect(() => { setDetail(null); loadDetail() }, [loadDetail])

  // a tap that navigates should also close the mobile drawer
  const location = useLocation()
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // keep the inbox badge live
  useEffect(() => {
    refreshUnread()
    const t = setInterval(refreshUnread, 20000)
    return () => clearInterval(t)
  }, [refreshUnread])

  const isAdmin = detail?.myRole === 'admin' || detail?.myRole === 'owner'

  return (
    <div className="flex h-full bg-surface">
      {/* ---------------- sidebar ---------------- */}
      {/* Sidebar: a fixed drawer under lg, a normal column above it. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col border-r border-line bg-surface-2 p-3 transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-2.5 pt-1.5 pb-3">
          <Logo />
        </div>

        <nav className="flex flex-col gap-0.5">
          <NavLink to="/" end className={navItem}>
            <IconHome /> My Dashboard
          </NavLink>
          <NavLink to="/inbox" className={navItem}>
            <IconBell /> Inbox
            {unread > 0 && (
              <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-pink-500 px-1.5 text-[10.5px] font-extrabold text-white">
                {unread}
              </span>
            )}
          </NavLink>
        </nav>

        <div className="-mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
          <SectionLabel
            action={
              <button onClick={() => setShowNewWs(true)} className="text-faint hover:text-brand-600" title="New workspace">
                <IconPlus size={13} />
              </button>
            }
          >
            WORKSPACES
          </SectionLabel>

          {workspaces === null && <div className="px-3 py-2"><Spinner /></div>}
          {workspaces?.length === 0 && <p className="px-3 py-1 text-xs text-faint">None yet</p>}

          {workspaces?.map((w) => {
            const active = w.id === activeId
            return (
              <div key={w.id}>
                <NavLink to={`/workspace/${w.id}`} className={navItem} end>
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: workspaceDot(w.id) }} />
                  <span className="truncate">{w.name}</span>
                  {w.myRole !== 'member' && (
                    <span className="ml-auto text-[9px] font-extrabold tracking-wide text-faint uppercase">
                      {w.myRole}
                    </span>
                  )}
                </NavLink>

                {/* expanded section for the workspace you're inside */}
                {active && detail && (
                  <div className="mt-0.5 mb-2 ml-3 flex flex-col gap-0.5 border-l border-line pl-2.5">
                    <NavLink to={`/workspace/${w.id}`} end className={subItem}>
                      <IconBoard size={14} /> Board
                    </NavLink>

                    <SectionLabel
                      action={
                        <button onClick={() => setShowNewChannel(true)} className="text-faint hover:text-brand-600" title="New channel">
                          <IconPlus size={12} />
                        </button>
                      }
                    >
                      CHANNELS
                    </SectionLabel>
                    {detail.workspace.channels.map((c) => (
                      <NavLink key={c.id} to={`/workspace/${w.id}/chat/${c.id}`} className={subItem}>
                        <IconHash size={13} className="text-faint" />
                        <span className="truncate">{c.name}</span>
                      </NavLink>
                    ))}

                    <div className="pt-2" />
                    <NavLink to={`/workspace/${w.id}/assistant`} className={subItem}>
                      <IconSparkle size={14} className="text-brand-600" /> Assistant
                      <Pill tone="brand" className="ml-auto !text-[8.5px]">BETA</Pill>
                    </NavLink>
                    <NavLink to={`/workspace/${w.id}/members`} className={subItem}>
                      <IconUsers size={14} /> Members
                      <span className="ml-auto text-[11px] font-bold text-faint">
                        {detail.workspace.members.length}
                      </span>
                    </NavLink>

                    {isAdmin && (
                      <NavLink to={`/workspace/${w.id}/analytics`} className={subItem}>
                        <IconChart size={14} className="text-amber-500" /> Team Analytics
                        <Pill tone="amber" className="ml-auto !text-[8.5px]">ADMIN</Pill>
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* profile */}
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
          <Avatar name={user?.name} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-bold">{user?.name}</div>
            <div className="truncate text-[10.5px] font-semibold text-faint">{user?.email}</div>
          </div>
          <button
            onClick={toggle}
            className="text-faint hover:text-brand-600"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
          <NavLink to="/settings" className="text-faint hover:text-brand-600" title="Settings">
            <IconSettings size={15} />
          </NavLink>
          <button onClick={() => { logout(); navigate('/login') }} className="text-faint hover:text-ink" title="Log out">
            <IconLogout size={15} />
          </button>
        </div>
      </aside>

      {/* dim the page behind the drawer on mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* ---------------- page ---------------- */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {user && !user.emailVerified && <VerifyBanner />}
        <Outlet
          context={{
            workspaces,
            reloadWorkspaces: loadWorkspaces,
            workspace: detail?.workspace || null,
            myRole: detail?.myRole || null,
            isAdmin,
            workspaceError: detailError,
            reloadWorkspace: loadDetail,
            refreshUnread,
            openNewWorkspace: () => setShowNewWs(true),
            showToast,
            showError,
            openMobileNav: () => setMobileOpen(true),
          }}
        />
      </main>

      <NewWorkspaceModal
        open={showNewWs}
        onClose={() => setShowNewWs(false)}
        onCreated={(ws) => {
          setShowNewWs(false)
          loadWorkspaces()
          navigate(`/workspace/${ws.id}`)
        }}
      />

      <NewChannelModal
        open={showNewChannel}
        onClose={() => setShowNewChannel(false)}
        workspaceId={activeId}
        onCreated={(ch) => {
          setShowNewChannel(false)
          loadDetail()
          navigate(`/workspace/${activeId}/chat/${ch.id}`)
        }}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

/** Soft nudge for unverified accounts — the app still works, we just prompt. */
function VerifyBanner() {
  const [state, setState] = useState({ status: 'idle' })

  const resend = async () => {
    setState({ status: 'sending' })
    try {
      const res = await resendVerification()
      setState({ status: 'sent', devUrl: res.verifyUrl })
    } catch (e) {
      setState({ status: 'error', message: e.response?.data?.error || 'Could not send' })
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-7 py-2.5">
      <IconMail size={16} className="shrink-0 text-amber-600" />
      <span className="flex-1 text-[12.5px] font-semibold text-amber-900">
        {state.status === 'sent' ? (
          <>
            Verification email sent.{' '}
            {state.devUrl && (
              <a href={state.devUrl} className="font-bold underline">
                Dev mode: open the link
              </a>
            )}
          </>
        ) : state.status === 'error' ? (
          state.message
        ) : (
          <>Please confirm your email address to secure your account.</>
        )}
      </span>
      {state.status !== 'sent' && (
        <button
          onClick={resend}
          disabled={state.status === 'sending'}
          className="shrink-0 text-[12px] font-extrabold text-amber-700 underline disabled:opacity-50"
        >
          {state.status === 'sending' ? 'Sending…' : 'Resend email'}
        </button>
      )}
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
    setBusy(true); setErr('')
    try {
      const ws = await createWorkspace(name.trim())
      setName('')
      onCreated(ws)
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create workspace')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New workspace">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Workspace name" placeholder="e.g. Product Team" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <p className="text-xs text-muted">You'll be the <b>owner</b> — you can invite people and promote them to admin from the Members page.</p>
        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function NewChannelModal({ open, onClose, workspaceId, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !workspaceId) return
    setBusy(true); setErr('')
    try {
      const ch = await createChannel(workspaceId, name.trim())
      setName('')
      onCreated(ch)
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create channel')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New channel">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Channel name" placeholder="engineering" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function PageHeader({ title, subtitle, badge, children }) {
  const { openMobileNav } = useOutletContext() || {}
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={openMobileNav} className="-ml-1 shrink-0 text-muted hover:text-ink lg:hidden" title="Menu"><IconMenu size={20} /></button>
        <h1 className="truncate font-display text-[19px] font-extrabold tracking-tight">{title}</h1>
        {badge}
        {subtitle && <span className="border-l border-line pl-3 text-[12.5px] font-semibold text-faint">{subtitle}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </header>
  )
}
